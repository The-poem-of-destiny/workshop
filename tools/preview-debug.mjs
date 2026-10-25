import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";

const state = resolve(process.env.PREVIEW_STATE ?? "/tmp/wb-preview-8800-state");
const backend = "http://10.125.47.40:8800";
const health = await fetch(`${backend}/api/v1/health`);
if (!health.ok) throw new Error("Start the isolated local Worker on port 8800 first");
const accounts = ["member", "reviewer", "owner"].map((role) => ({
  role,
  token: randomBytes(32).toString("hex"),
}));
const sql =
  accounts
    .map(({ role, token }) => {
      const id = `preview-debug-${role}`;
      const user =
        role === "member" ? `(SELECT author_id FROM projects WHERE deleted_at IS NULL ORDER BY id LIMIT 1)` : `'${id}'`;
      return `INSERT OR IGNORE INTO users (id,username,global_name,role) VALUES ('${id}','${id}','Debug ${role}','${role}');
INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ('${createHash("sha256").update(token).digest("hex")}',COALESCE(${user},'${id}'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'));`;
    })
    .join("\n") +
  `
INSERT OR IGNORE INTO discovery_exposures (bucket, project_id, rank)
SELECT strftime('%Y-%m-%d','now'), id, ROW_NUMBER() OVER (ORDER BY project_type, id)
FROM projects WHERE visibility='public' AND deleted_at IS NULL AND published_revision_id IS NOT NULL
ORDER BY project_type, id LIMIT 12;`;
const seed = spawnSync(
  "pnpm",
  [
    "--filter",
    "@workshop/worker",
    "exec",
    "wrangler",
    "d1",
    "execute",
    "workshop-staging",
    "--local",
    "--persist-to",
    state,
    "--config",
    "wrangler.jsonc",
    "--env",
    "staging",
    "--command",
    sql,
  ],
  { stdio: "pipe", encoding: "utf8" },
);
if (seed.status !== 0) throw new Error(`Local preview seed failed: ${seed.stderr}`);

async function localApi(path, init = {}, role = "member") {
  const account = accounts.find((value) => value.role === role);
  const response = await fetch(`${backend}/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${account.token}`, ...init.headers },
  });
  if (!response.ok) throw new Error(`Local preview ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}
const catalogue = await localApi("/projects?limit=12");
for (const project of catalogue.items) {
  await localApi(`/me/subscriptions/${project.id}`, { method: "PUT" });
}
const owned = await localApi("/me/projects");
if (!owned.items.some((entry) => entry.project.title === "Debug 审核预览")) {
  const created = await localApi("/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Debug 审核预览", description: "本地预览用待审项目", projectType: "事件" }),
  });
  const worldbook = JSON.stringify({ entries: [{ uid: 1, key: ["预览"], content: "本地审核界面预览内容。" }] });
  const revisionPath = `/projects/${created.project.id}/revisions/${created.workingRevisionId}`;
  const uploaded = await localApi(`${revisionPath}/files/worldbook`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": String(created.rowVersion) },
    body: worldbook,
  });
  const visible = await localApi(`/projects/${created.project.id}/visibility`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "if-match": String(uploaded.rowVersion) },
    body: JSON.stringify({ visibility: "public" }),
  });
  await localApi(`${revisionPath}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", "if-match": String(visible.rowVersion) },
    body: JSON.stringify({ gate: "missing", acknowledged: true }),
  });
}
const examples = [
  { title: "港口贸易与航线", type: "扩展", submit: true },
  { title: "队伍宿营事件集", type: "事件", submit: true },
  { title: "人物关系与声望", type: "系统核心", submit: true },
  { title: "群岛角色补充", type: "角色", submit: true },
  { title: "本地冒险札记", type: "事件", submit: false },
  { title: "装备属性整理", type: "扩展", submit: false },
  { title: "长篇世界观资料与地域风俗补充", type: "扩展", submit: false },
  { title: "待修改的对话样式", type: "扩展", submit: true, reject: true },
];
for (const [index, sample] of examples.entries()) {
  const title = `[预览] ${sample.title}`;
  if (owned.items.some((entry) => entry.project.title === title)) continue;
  const created = await localApi("/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      description: `本地工作区预览：${sample.title}。提供背景规则、使用说明和示例内容，方便检查编辑与审核流程。`,
      projectType: sample.type,
      versionLabel: `1.${index}.0`,
      tags: ["本地预览", sample.type],
    }),
  });
  const revisionPath = `/projects/${created.project.id}/revisions/${created.workingRevisionId}`;
  const body = JSON.stringify({
    entries: Array.from({ length: (index % 3) + 2 }, (_, entry) => ({
      uid: entry + 1,
      key: [sample.title, `条目${entry + 1}`],
      content: `${sample.title}：${["背景与适用范围", "交互规则与边界", "场景示例", "补充说明"][entry]}。\n仅用于本地预览，包含可阅读的段落与规则内容。`,
    })),
  });
  let latest = await localApi(`${revisionPath}/files/worldbook`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": String(created.rowVersion) },
    body,
  });
  if (!sample.submit) continue;
  latest = await localApi(`/projects/${created.project.id}/visibility`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "if-match": String(latest.rowVersion) },
    body: JSON.stringify({ visibility: "public" }),
  });
  const submitted = await localApi(`${revisionPath}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", "if-match": String(latest.rowVersion) },
    body: JSON.stringify({ gate: "missing", acknowledged: true }),
  });
  if (sample.reject) {
    await localApi(
      `/admin/submissions/${submitted.submissionId ?? submitted.id}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "reject", reason: "本地预览：请补充兼容版本和使用说明后重新提交。" }),
      },
      "reviewer",
    );
  }
}
const child = spawn(
  "pnpm",
  [
    "--filter",
    "@workshop/worker",
    "exec",
    "vite",
    "--config",
    "web/vite.config.ts",
    "--mode",
    "local-preview",
    "--host",
    "10.125.47.40",
    "--port",
    "8801",
    "--strictPort",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, PREVIEW_DEBUG_ACCOUNTS: JSON.stringify(accounts) },
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
