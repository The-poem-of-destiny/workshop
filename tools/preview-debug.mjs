import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const workerDir = resolve(root, "apps/worker");

// The preview address is machine-local: it lives in the untracked `.env`, never
// in source. Only `PREVIEW_*` keys are read, so unrelated secrets in that file
// (Cloudflare tokens and the like) never reach a child process.
function localSetting(name) {
  if (process.env[name]) return process.env[name];
  const file = resolve(root, ".env");
  if (!existsSync(file)) return undefined;
  return parseEnv(readFileSync(file, "utf8"))[name];
}

const host = localSetting("PREVIEW_HOST");
if (!host) {
  console.error(
    "PREVIEW_HOST is not set. Add it to the untracked .env at the repository root (see .env.example), for example PREVIEW_HOST=127.0.0.1 or the LAN/ZeroTier address this machine listens on.",
  );
  process.exit(1);
}
const state = resolve(root, localSetting("PREVIEW_STATE") ?? ".local/discovery-preview-state");
const backend = `http://${host}:8800`;
const frontend = `http://${host}:8801`;
const localEnv = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
delete localEnv.CLOUDFLARE_API_TOKEN;
const children = new Set();
let timer;
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") console.error(error.message);
    }
  }
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop(0));
process.once("exit", () => stop(process.exitCode ?? 0));

function start(script, args, extraEnv = {}) {
  const child = spawn(process.execPath, [resolve(workerDir, script), ...args], {
    cwd: workerDir,
    env: { ...localEnv, ...extraEnv },
    stdio: "inherit",
    detached: true,
  });
  children.add(child);
  child.once("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code || 1);
  });
  return child;
}

async function requireFreePort(port) {
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Preview ${host}:${port} is unavailable; stop the old preview first`)));
    server.listen(port, host, () => server.close(accept));
  });
}

async function waitForWorker() {
  const deadline = Date.now() + 60_000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(`${backend}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      // The local workerd process is still starting.
    }
    await new Promise((accept) => setTimeout(accept, 250));
  }
  throw new Error("Local preview Worker did not become ready");
}

function wrangler(args) {
  const result = spawnSync(
    process.execPath,
    [
      resolve(workerDir, "node_modules/wrangler/bin/wrangler.js"),
      ...args,
      "--local",
      "--persist-to",
      state,
      "--config",
      "wrangler.jsonc",
    ],
    { cwd: workerDir, env: localEnv, stdio: "pipe", encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`Local preview database command failed: ${result.stderr || result.stdout}`);
}

const accounts = ["member", "reviewer", "owner"].map((role) => ({ role, token: randomBytes(32).toString("hex") }));
function seedAccounts() {
  const sql = accounts
    .map(({ role, token }) => {
      const id = `preview-debug-${role}`;
      const user =
        role === "member"
          ? // Prefer the author that already owns a seeded sample so re-runs
            // keep editing the same rows; otherwise fall back to any member.
            `(SELECT p.author_id FROM projects p
                JOIN project_versions v ON v.id = p.published_version_id
                JOIN users u ON u.id = p.author_id
               WHERE p.deleted_at IS NULL AND u.role = 'member' AND v.title LIKE '[预览]%'
               ORDER BY p.id LIMIT 1)
             `
          : `'${id}'`;
      return `INSERT INTO users (id,username,global_name,role) VALUES ('${id}','${id}','Debug ${role}','${role}')
        ON CONFLICT(id) DO UPDATE SET role=excluded.role;
        INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ('${createHash("sha256").update(token).digest("hex")}',COALESCE(${user},'${id}'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'));`;
    })
    .join("\n");
  wrangler(["d1", "execute", "DB", "--command", sql]);
}

async function localApi(path, init = {}, role = "member") {
  const account = accounts.find((value) => value.role === role);
  const response = await fetch(`${backend}/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${account.token}`, ...init.headers },
  });
  if (!response.ok) throw new Error(`Local preview ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function seedExamples() {
  for (const { role } of accounts) {
    const me = await localApi("/me", {}, role);
    if (me.user.role !== role) throw new Error(`Local preview ${role} account has the wrong role`);
  }
  const catalogue = await localApi("/projects?limit=12");
  for (const project of catalogue.items) await localApi(`/me/subscriptions/${project.id}`, { method: "PUT" });
  const owned = await localApi("/me/projects");
  // Reuse already-seeded rows so re-runs stay idempotent, and let a soft
  // pairing point at a project this same seeding pass creates.
  const idsByTitle = new Map(owned.items.map((entry) => [entry.project.title, entry.project.id]));
  const examples = [
    { title: "港口贸易与航线", type: "扩展", extension: "规则", submit: true, approve: true },
    { title: "队伍宿营事件集", type: "事件", submit: true },
    { title: "人物关系与声望", type: "系统核心", submit: true, approve: true },
    { title: "群岛角色补充", type: "角色", submit: true, approve: true },
    { title: "群岛人物与事件合集", type: "角色", submit: true, approve: true },
    { title: "本地冒险札记", type: "事件", submit: false },
    { title: "装备属性整理", type: "扩展", extension: "内容", submit: false },
    {
      title: "长篇世界观资料与地域风俗补充",
      type: "扩展",
      extension: "内容",
      submit: true,
      approve: true,
      recommend: [
        { title: "人物关系与声望", note: "人物与关系数据由它统一记录" },
        { title: "港口贸易与航线", note: "配合航线规则，风土条目才对应得上" },
      ],
    },
    { title: "待修改的对话样式", type: "扩展", extension: "规则", submit: true, reject: true },
  ];
  for (const [index, sample] of examples.entries()) {
    const title = `[预览] ${sample.title}`;
    const existing = idsByTitle.get(title);
    if (existing) continue;
    const recommended = (sample.recommend ?? [])
      .map((entry) => {
        const projectId = idsByTitle.get(`[预览] ${entry.title}`);
        return projectId ? { target: { kind: "project", projectId }, note: entry.note } : null;
      })
      .filter((entry) => entry !== null);
    const created = await localApi("/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        description: `本地工作区预览：${sample.title}。提供背景规则、使用说明和示例内容，方便检查编辑与审核流程。`,
        projectType: sample.type,
        extensionType: sample.extension ?? null,
        versionLabel: `1.${index}.0`,
        tags: ["本地预览", sample.type],
        ...(sample.recommend
          ? {
              requirements: {
                schemaVersion: 1,
                dependencies: [],
                conflicts: [],
                recommended: [...recommended, { target: { kind: "external", text: "任意航海主题的美术包" } }],
                notes: "",
              },
            }
          : {}),
      }),
    });
    idsByTitle.set(title, created.project.id);
    const versionPath = `/projects/${created.project.id}/versions/${created.workingVersionId}`;
    const body = JSON.stringify({
      entries: Array.from({ length: (index % 3) + 2 }, (_, entry) => ({
        uid: entry + 1,
        key: [sample.title, `条目${entry + 1}`],
        content: `${sample.title}：${["背景与适用范围", "交互规则与边界", "场景示例", "补充说明"][entry]}。\n仅用于本地预览。`,
      })),
    });
    const uploaded = await localApi(`${versionPath}/files/worldbook`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": String(created.rowVersion) },
      body,
    });
    if (!sample.submit) continue;
    const visible = await localApi(`/projects/${created.project.id}/visibility`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": String(uploaded.rowVersion) },
      body: JSON.stringify({ visibility: "public" }),
    });
    const submitted = await localApi(`${versionPath}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", "if-match": String(visible.rowVersion) },
      body: JSON.stringify({ gate: "missing", acknowledged: true }),
    });
    if (sample.reject) {
      await localApi(
        `/admin/submissions/${submitted.submissionId}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "reject", reason: "本地预览：请补充兼容版本和使用说明后重新提交。" }),
        },
        "reviewer",
      );
    }
    if (sample.approve) {
      // The catalogue only shows approved revisions, so the demo rows need a
      // human decision; local checks never produce a passing gate on their own.
      await localApi(
        `/admin/submissions/${submitted.submissionId}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "approve", reason: "本地预览：人工放行以检查目录与项目页。" }),
        },
        "reviewer",
      );
    }
  }
}

async function seedDiscoveryRecommendations() {
  const response = await fetch(`${backend}/api/v1/projects/discovery`);
  if (!response.ok) throw new Error(`Local preview discovery: ${response.status}`);
  const discovery = await response.json();
  const curators = [
    { id: "preview-discovery-reader-1", name: "阿岚（预览）" },
    { id: "preview-discovery-reader-2", name: "雾港旅人（预览）" },
    { id: "preview-discovery-reader-3", name: "名字比较长的航路记录员（预览）" },
  ];
  const comments = [
    "【本地样例，非真实评价】设定清楚，适合直接开始一段新旅程。",
    "【本地样例，非真实评价】\n喜欢这里循序渐进的设定展开：先给足行动空间，再让人物关系和世界规则慢慢浮现。简介里的信息比较集中，建议先打开详情看看适用范围，再决定是否加入当前配置。\n这是一条中等长度、带换行的推荐语，用来检查推荐人、正文和切换按钮之间的间距。",
    "【本地样例，非真实评价】\n这是一条刻意写长的推荐语，方便检查发现区域在信息较多时的阅读体验。最吸引我的部分，是设定没有只停留在背景介绍，而是把可以参与的事件、人物关系和潜在冲突放在了一起。初次接触时可以顺着简介进入详情，先确认前置条件，再选择自己感兴趣的方向。\n\n实际游玩时，我更喜欢从一件小事开始：接下一份委托、拜访一位旧识，或者在港口打听一条传闻。这样的入口不需要一次记住全部设定，却能逐渐认识人物的立场与彼此之间的联系。对于偏好慢节奏探索的人，细节可以成为很好的互动线索；想推进主线时，也能从明确的矛盾里找到行动目标。\n\n这里继续保留一段较长的文字，用来观察窄屏下的换行、段落间距以及右栏滚动。推荐语不应该挤扁左侧主图，也不应该把整个发现组件撑出半屏；当文字超过可用高度时，只滚动右侧内容，滚到底之后仍应允许页面继续向下。切换到另一条短评时，内容应恢复自然居中的位置。\n\n最后提醒：以上只是本地界面样例，不代表真实玩家的使用经历、兼容性结论或质量评价。请以项目详情、作者说明和实际内容为准。",
  ];
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const now = quote(new Date().toISOString());
  const sql = curators.map(
    ({
      id,
      name,
    }) => `INSERT INTO users (id,username,global_name,role) VALUES (${quote(id)},${quote(id)},${quote(name)},'member')
      ON CONFLICT(id) DO UPDATE SET global_name=excluded.global_name;`,
  );
  sql.push(`DELETE FROM recommendations WHERE curator_id IN (${curators.map(({ id }) => quote(id)).join(",")});`);
  const projects = discovery.items.slice(0, 3);
  for (const [projectIndex, project] of projects.entries()) {
    const sampleComments = projectIndex === 0 ? comments : [comments[projectIndex - 1]];
    for (const [index, comment] of sampleComments.entries()) {
      const curator = curators[index];
      sql.push(`INSERT INTO recommendations (id,curator_id,project_id,project_version_id,comment,created_at,updated_at)
        VALUES (${quote(`preview-discovery-${project.id}-${index}`)},${quote(curator.id)},${quote(project.id)},${quote(project.publishedVersionId)},${quote(comment)},${now},${now});`);
    }
  }
  wrangler(["d1", "execute", "DB", "--command", sql.join("\n")]);
  console.log(
    `Local preview recommendation samples: ${projects.map((project, index) => `${project.title} (${index === 0 ? 3 : 1})`).join(", ") || "no eligible projects"}`,
  );
}

let lastScheduledTime;
async function tickSchedule() {
  const now = new Date();
  const scheduled = new Date(now);
  scheduled.setUTCMinutes(5, 0, 0);
  if (scheduled > now) scheduled.setUTCHours(scheduled.getUTCHours() - 1);
  const time = scheduled.getTime();
  if (time === lastScheduledTime) return;
  const query = new URLSearchParams({ time: String(time), cron: "*/1 * * * *", format: "json" });
  // Node fetch replaces Host; use the native client for Miniflare's loopback-only control route.
  const result = await new Promise((accept, reject) => {
    const req = request(`${backend}/cdn-cgi/local/scheduled?${query}`, { headers: { Host: "localhost" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) throw new Error(`Local preview schedule: ${res.statusCode} ${body}`);
          accept(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
      res.on("error", reject);
    });
    req.setTimeout(60_000, () => req.destroy(new Error("Local preview scheduled event timed out")));
    req.on("error", reject);
    req.end();
  });
  if (result.outcome !== "ok") throw new Error(`Local preview scheduled event failed: ${result.outcome}`);
  await seedDiscoveryRecommendations();
  lastScheduledTime = time;
  console.log(`Local preview scheduled event: ${scheduled.toISOString()}`);
}

try {
  await requireFreePort(8800);
  await requireFreePort(8801);
  wrangler(["d1", "migrations", "apply", "DB"]);
  seedAccounts();
  start("node_modules/wrangler/bin/wrangler.js", [
    "dev",
    "--local",
    "--test-scheduled",
    "--persist-to",
    state,
    "--ip",
    host,
    "--port",
    "8800",
    "--var",
    `PUBLIC_ORIGIN:${frontend}`,
    "--var",
    `ALLOWED_ORIGINS:${frontend}`,
    "--var",
    "SESSION_HASH_SECRET:",
    "--var",
    "CACHE_TTL_PUBLIC_SECONDS:0",
  ]);
  await waitForWorker();
  await seedExamples();
  await tickSchedule();
  timer = setInterval(() => void tickSchedule().catch((error) => console.error(error.message)), 60_000);
  start(
    "node_modules/vite/bin/vite.js",
    ["--config", "web/vite.config.ts", "--mode", "local-preview", "--host", host, "--port", "8801", "--strictPort"],
    { PREVIEW_DEBUG_ACCOUNTS: JSON.stringify(accounts), PREVIEW_API_ORIGIN: backend },
  );
  console.log(`Local preview: ${frontend}/ — Ctrl+C stops the Worker, frontend and schedule together.`);
} catch (error) {
  console.error(error.message);
  stop(1);
}
