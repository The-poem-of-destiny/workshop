#!/usr/bin/env node
/**
 * Local HTTP E2E: starts the real Worker in workerd against local D1/R2,
 * seeds two users, then exercises the full author -> review -> public flow.
 *
 * Usage: node tools/e2e-local.mjs
 * Requires: built apps/worker/web/dist and local D1 migrations.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(root, "apps/worker");
const port = Number(process.env.E2E_PORT ?? 8791);
const base = `http://127.0.0.1:${port}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), "workshop-e2e-"));
let server;

const authorToken = "e2e-author-token";
const ownerToken = "e2e-owner-token";
const hash = value => createHash("sha256").update(value).digest("hex");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function wrangler(args, input) {
  const result = spawnSync(
    "pnpm",
    ["--filter", "@workshop/worker", "exec", "wrangler", ...args],
    { cwd: root, encoding: "utf8", input, env: { ...process.env, CI: "1" } },
  );
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

async function api(pathname, init = {}, token) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${base}${pathname}`, { ...init, headers });
  return { response, body: await response.text() };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function chromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  if (!existsSync(cache)) return null;
  for (const name of readdirSync(cache).filter(value => value.startsWith("chromium-")).sort().reverse()) {
    for (const candidate of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const full = path.join(cache, name, candidate);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

async function waitForWorker() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error("worker did not become ready");
}

async function main() {
  wrangler(["d1", "migrations", "apply", "workshop-staging", "--local", "--config", "wrangler.jsonc"]);
  const logFile = path.join(tmp, "wrangler.log");
  const log = (await import("node:fs")).createWriteStream(logFile);
  server = spawn("pnpm", ["exec", "wrangler", "dev", "--config", "wrangler.jsonc", "--env", "staging", "--port", String(port), "--log-level", "error"], {
    cwd: workerDir,
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);

  try {
    await waitForWorker();

    wrangler(["d1", "execute", "workshop-staging", "--local", "--command", `
      DELETE FROM download_events WHERE user_id IN ('e2e-author','e2e-owner');
      DELETE FROM reviews WHERE reviewer_id IN ('e2e-author','e2e-owner');
      DELETE FROM submissions WHERE submitted_by IN ('e2e-author','e2e-owner');
      DELETE FROM assets WHERE project_id IN (SELECT id FROM projects WHERE author_id = 'e2e-author');
      DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE author_id = 'e2e-author');
      DELETE FROM projects WHERE author_id = 'e2e-author';
      DELETE FROM sessions WHERE user_id IN ('e2e-author','e2e-owner');
      DELETE FROM users WHERE id IN ('e2e-author','e2e-owner');
      INSERT INTO users (id, username, global_name, role) VALUES ('e2e-author','e2e-author','E2E Author','member');
      INSERT INTO users (id, username, global_name, role) VALUES ('e2e-owner','e2e-owner','E2E Owner','owner');
      INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('${hash(authorToken)}','e2e-author','2099-01-01T00:00:00.000Z');
      INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('${hash(ownerToken)}','e2e-owner','2099-01-01T00:00:00.000Z');
    `]);

    const passed = [];
    const check = async (name, fn) => { await fn(); passed.push(name); console.log(`ok ${passed.length} - ${name}`); };

    await check("health", async () => {
      const { response, body } = await api("/api/v1/health");
      assert(response.status === 200 && JSON.parse(body).ok === true, "health failed");
    });

    await check("static UI", async () => {
      const response = await fetch(`${base}/`);
      const body = await response.text();
      assert(response.status === 200 && response.headers.get("content-type")?.includes("text/html"), "root is not HTML");
      assert(body.includes('id="root"'), "root missing mount");
      const assetPath = /src="(\/assets\/[^"]+\.js)"/.exec(body)?.[1];
      assert(assetPath, "hashed asset missing");
      const asset = await fetch(`${base}${assetPath}`);
      assert(asset.status === 200, "hashed asset status");
      assert(asset.headers.get("cache-control")?.includes("immutable"), "hashed asset immutable");
    });

    await check("public list", async () => {
      const first = await api("/api/v1/projects");
      assert(first.response.status === 200 && Array.isArray(JSON.parse(first.body).items), "list shape");
      const second = await api("/api/v1/projects");
      assert(second.response.headers.get("x-cache") === "HIT", `list cache hit: ${second.response.headers.get("x-cache")}`);
      assert(second.response.headers.get("cache-control")?.includes("public"), "list public cache header");
    });

    let project;
    await check("author creates project", async () => {
      const { response, body } = await api("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "E2E Project", description: "e2e", projectType: "角色", tags: ["e2e"] }),
      }, authorToken);
      assert(response.status === 201, `create ${response.status}: ${body}`);
      project = JSON.parse(body);
      assert(project.project.id && project.workingRevisionId, "create shape");
      const afterCreate = await api("/api/v1/projects");
      assert(afterCreate.response.headers.get("x-cache") === "MISS", `epoch invalidation: ${afterCreate.response.headers.get("x-cache")}`);
    });

    await check("author uploads assets", async () => {
      const worldbook = '{"entries":[{"uid":1,"key":["e2e"],"content":"hello"}]}';
      const wb = await api(`/api/v1/projects/${project.project.id}/revisions/${project.workingRevisionId}/files/worldbook`, {
        method: "PUT",
        headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(worldbook)) },
        body: worldbook,
      }, authorToken);
      assert(wb.response.status === 200, `worldbook ${wb.response.status}: ${wb.body}`);
      const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082", "hex");
      const cover = await api(`/api/v1/projects/${project.project.id}/revisions/${project.workingRevisionId}/files/cover`, {
        method: "PUT",
        headers: { "content-type": "image/png", "content-length": String(png.length) },
        body: png,
      }, authorToken);
      assert(cover.response.status === 200, `cover ${cover.response.status}: ${cover.body}`);
    });

    await check("private detail is 404", async () => {
      const { response } = await api(`/api/v1/projects/${project.project.id}`);
      assert(response.status === 404, `private detail ${response.status}`);
      const draft = await api(`/api/v1/projects/${project.project.id}/draft`, {}, authorToken);
      assert(draft.response.status === 200, `author draft ${draft.response.status}`);
    });

    await check("author publishes and auto-publishes", async () => {
      const visibility = await api(`/api/v1/projects/${project.project.id}/visibility`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "if-match": "1" },
        body: JSON.stringify({ visibility: "public" }),
      }, authorToken);
      assert(visibility.response.status === 200, `visibility ${visibility.response.status}: ${visibility.body}`);
      const submit = await api(`/api/v1/projects/${project.project.id}/revisions/${project.workingRevisionId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gate: "warn",
          checkerRevision: "e2e",
          warningCount: 1,
          acknowledged: true,
        }),
      }, authorToken);
      assert(submit.response.status === 201, `submit ${submit.response.status}: ${submit.body}`);

      let detail;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        detail = await api(`/api/v1/projects/${project.project.id}`);
        if (detail.response.status === 200) break;
        await sleep(250);
      }
      assert(detail?.response.status === 200, `public detail ${detail?.response.status}: ${detail?.body}`);
      assert(JSON.parse(detail.body).id === project.project.id, "public id");
      const manifest = await api(`/api/v1/projects/${project.project.id}/releases/${project.workingRevisionId}/manifest`, {}, authorToken);
      assert(manifest.response.status === 200, `manifest ${manifest.response.status}: ${manifest.body}`);
      const parsed = JSON.parse(manifest.body);
      assert(parsed.manifestHash && parsed.files.some(file => file.kind === "worldbook"), "manifest shape");
      const file = await api(`/api/v1/projects/${project.project.id}/releases/${project.workingRevisionId}/files/worldbook`, {}, authorToken);
      assert(file.response.status === 200 && file.body.includes("hello"), "release file");
      const cover = await fetch(`${base}${JSON.parse(detail.body).coverUrl}`);
      assert(cover.status === 200 && cover.headers.get("content-type")?.includes("image/png"), "public cover");
    });

    await check("author creates a second published project for ordering", async () => {
      await sleep(1100);
      const created = await api("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "E2E Sort", description: "ordering", projectType: "事件" }),
      }, authorToken);
      assert(created.response.status === 201, `sort create ${created.response.status}: ${created.body}`);
      const second = JSON.parse(created.body);
      const worldbook = '{"entries":[{"uid":1,"key":["sort"],"content":"sort body"}]}';
      const upload = await api(`/api/v1/projects/${second.project.id}/revisions/${second.workingRevisionId}/files/worldbook`, {
        method: "PUT",
        headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(worldbook)) },
        body: worldbook,
      }, authorToken);
      assert(upload.response.status === 200, `sort upload ${upload.response.status}: ${upload.body}`);
      const visibility = await api(`/api/v1/projects/${second.project.id}/visibility`, {
        method: "PATCH", headers: { "content-type": "application/json", "if-match": "1" },
        body: JSON.stringify({ visibility: "public" }),
      }, authorToken);
      assert(visibility.response.status === 200, `sort visibility ${visibility.response.status}: ${visibility.body}`);
      const submit = await api(`/api/v1/projects/${second.project.id}/revisions/${second.workingRevisionId}/submit`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gate: "pass" }),
      }, authorToken);
      assert(submit.response.status === 201, `sort submit ${submit.response.status}: ${submit.body}`);
      let detail;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        detail = await api(`/api/v1/projects/${second.project.id}`);
        if (detail.response.status === 200) break;
        await sleep(250);
      }
      assert(detail?.response.status === 200, `sort public detail ${detail?.response.status}`);
      const draft = await api(`/api/v1/projects/${project.project.id}/draft`, {}, authorToken);
      const rowVersion = JSON.parse(draft.body).rowVersion;
      const patched = await api(`/api/v1/projects/${project.project.id}`, {
        method: "PATCH", headers: { "content-type": "application/json", "if-match": String(rowVersion) },
        body: JSON.stringify({ title: "E2E Project" }),
      }, authorToken);
      assert(patched.response.status === 200, `sort patch ${patched.response.status}: ${patched.body}`);
    });

    await check("download tickets are idempotent and one-time", async () => {
      const first = await api(`/api/v1/projects/${project.project.id}/downloads`, { method: "POST" }, authorToken);
      const second = await api(`/api/v1/projects/${project.project.id}/downloads`, { method: "POST" }, authorToken);
      assert(first.response.status === 201 && second.response.status === 201, "download status");
      const ticket = JSON.parse(first.body);
      assert(ticket.files?.length === 1, "download ticket shape");
      const file = await api(ticket.files[0].url, {}, authorToken);
      assert(file.response.status === 200 && file.body.includes("hello"), "ticket download");
      const replay = await api(ticket.files[0].url, {}, authorToken);
      assert(replay.response.status === 404, "ticket replay");
      const detail = await api(`/api/v1/projects/${project.project.id}`);
      assert(JSON.parse(detail.body).counts.downloads === 1, "download counted exactly once");
    });

    await check("author subscribes to a public project", async () => {
      const subscribed = await api(`/api/v1/me/subscriptions/${project.project.id}`, { method: "PUT" }, authorToken);
      assert(subscribed.response.status === 204, `subscribe ${subscribed.response.status}: ${subscribed.body}`);
      const list = await api("/api/v1/me/subscriptions", {}, authorToken);
      assert(list.response.status === 200 && JSON.parse(list.body).items.some(item => item.id === project.project.id), "subscription list");
    });

    async function createPending(title, key) {
      const created = await api("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description: "manual review", projectType: "事件" }),
      }, authorToken);
      assert(created.response.status === 201, `pending create ${created.response.status}: ${created.body}`);
      const project = JSON.parse(created.body);
      const worldbook = JSON.stringify({ entries: [{ uid: 1, key: [key], content: key }] });
      const upload = await api(`/api/v1/projects/${project.project.id}/revisions/${project.workingRevisionId}/files/worldbook`, {
        method: "PUT",
        headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(worldbook)) },
        body: worldbook,
      }, authorToken);
      assert(upload.response.status === 200, `pending upload ${upload.response.status}: ${upload.body}`);
      const visibility = await api(`/api/v1/projects/${project.project.id}/visibility`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "if-match": "1" },
        body: JSON.stringify({ visibility: "public" }),
      }, authorToken);
      assert(visibility.response.status === 200, `pending visibility ${visibility.response.status}: ${visibility.body}`);
      const submit = await api(`/api/v1/projects/${project.project.id}/revisions/${project.workingRevisionId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gate: "missing", acknowledged: true }),
      }, authorToken);
      assert(submit.response.status === 201, `pending submit ${submit.response.status}: ${submit.body}`);
      return project.project.id;
    }

    let pendingId = "";
    await check("author submits without client checker", async () => {
      pendingId = await createPending("E2E Pending", "pending");
      await createPending("E2E Approve", "approve");
    });

    const executablePath = chromiumExecutable();
    if (executablePath) {
      const browser = await chromium.launch({ headless: true, executablePath });
      try {
        await check("browser anonymous search and detail", async () => {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.locator(".card").first().waitFor({ state: "visible", timeout: 10_000 });
          await page.getByRole("button", { name: "下载", exact: true }).click();
          assert((await page.getByRole("button", { name: "下载", exact: true }).getAttribute("class"))?.includes("active") ?? false, "sort active");
          await page.locator('input[type="search"]').fill("E2E Project");
          await page.locator(".card", { hasText: "E2E Project" }).first().waitFor({ state: "visible", timeout: 10_000 });
          await page.locator(".card", { hasText: "E2E Project" }).first().click();
          await page.locator(".detail").waitFor({ state: "visible" });
          assert((await page.locator(".detail").textContent())?.includes("E2E Project"), "detail content");
          assert((await page.locator(".detail").textContent())?.includes("SillyTavern"), "unauthenticated install hint");
          await page.locator(".detail .author.link").click();
          await page.getByText("作者：E2E Author", { exact: false }).waitFor({ state: "visible" });
          await page.getByRole("button", { name: "清除", exact: true }).click();
          await page.close();
        });

        await check("browser sort tabs reorder actual cards", async () => {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.locator('input[type="search"]').fill("E2E");
          await page.locator(".card", { hasText: "E2E Sort" }).first().waitFor({ state: "visible", timeout: 10_000 });
          const firstTitle = async () => (await page.locator(".card h3").first().textContent())?.trim();
          assert(await firstTitle() === "E2E Project", `updated order: ${await firstTitle()}`);
          await page.getByRole("button", { name: "发布时间", exact: true }).click();
          await page.waitForFunction(() => document.querySelector(".card h3")?.textContent?.trim() === "E2E Sort", null, { timeout: 10_000 });
          assert(await firstTitle() === "E2E Sort", `published order: ${await firstTitle()}`);
          await page.getByRole("button", { name: "下载", exact: true }).click();
          await page.waitForFunction(() => document.querySelector(".card h3")?.textContent?.trim() === "E2E Project", null, { timeout: 10_000 });
          assert(await firstTitle() === "E2E Project", `download order: ${await firstTitle()}`);
          await page.close();
        });

        await check("browser author workspace", async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          await context.addInitScript(token => sessionStorage.setItem("cw_session_token", token), authorToken);
          const page = await context.newPage();
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: "我的项目" }).click();
          await page.getByText("E2E Project", { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
          await page.getByText("E2E Project", { exact: true }).first().click();
          await page.getByRole("button", { name: "提交当前版本" }).waitFor({ state: "visible" });
          assert((await page.locator(".workspace").textContent())?.includes("提交审核"), "submit box");
          await page.getByRole("button", { name: "订阅", exact: true }).click();
          await page.getByText("E2E Project", { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
          await context.close();
        });

        await check("browser owner admin tools", async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          await context.addInitScript(token => sessionStorage.setItem("cw_session_token", token), ownerToken);
          const page = await context.newPage();
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: "管理" }).click();
          await page.getByText("站点设置", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
          await page.getByText("成员", { exact: true }).waitFor({ state: "visible" });
          await page.getByText("审计", { exact: true }).waitFor({ state: "visible" });
          await page.getByRole("button", { name: "保存站点设置" }).click();
          await page.getByText("站点设置已保存").waitFor({ state: "visible", timeout: 10_000 });
          await context.close();
        });

        await check("browser admin approves with reason", async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          await context.addInitScript(token => sessionStorage.setItem("cw_session_token", token), ownerToken);
          const page = await context.newPage();
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: "审核台" }).click();
          await page.getByText("E2E Approve", { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
          await page.getByText("E2E Approve", { exact: true }).first().click();
          await page.locator("textarea").fill("e2e approval reason");
          await page.getByRole("button", { name: "通过", exact: true }).click();
          await page.getByText("已通过审核").waitFor({ state: "visible", timeout: 10_000 });
          await context.close();
        });

        await check("browser admin queue rejects without reason", async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          await context.addInitScript(token => sessionStorage.setItem("cw_session_token", token), ownerToken);
          const page = await context.newPage();
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: "审核台" }).click();
          await page.getByText("E2E Pending", { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
          await page.getByText("E2E Pending", { exact: true }).first().click();
          await page.getByRole("button", { name: "拒绝" }).click();
          await page.getByText("拒绝审核必须填写理由").waitFor({ state: "visible" });
          await page.locator("textarea").fill("e2e rejection reason");
          await page.getByRole("button", { name: "拒绝" }).click();
          await page.getByText("已拒绝审核").waitFor({ state: "visible", timeout: 10_000 });
          await context.close();
        });

        await check("browser author revises rejected project and resubmits", async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          await context.addInitScript(token => sessionStorage.setItem("cw_session_token", token), authorToken);
          const page = await context.newPage();
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: "我的项目" }).click();
          await page.getByText("E2E Pending", { exact: true }).first().click();
          await page.getByText("e2e rejection reason", { exact: false }).waitFor({ state: "visible", timeout: 10_000 });
          await page.getByRole("button", { name: "新建版本" }).click();
          await page.getByText("现在可以上传修改后的文件", { exact: false }).waitFor({ state: "visible", timeout: 10_000 });
          await page.locator('input[type="file"][accept*=".json"]').first().setInputFiles({
            name: "worldbook.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify({ entries: [{ uid: 2, key: ["revised"], content: "revised pending" }] })),
          });
          const outcome = await Promise.race([
            page.getByText("世界书已上传").waitFor({ state: "visible", timeout: 10_000 }).then(() => "uploaded"),
            page.locator(".error").waitFor({ state: "visible", timeout: 10_000 }).then(async () => `error: ${await page.locator(".error").textContent()}`),
          ]);
          assert(outcome === "uploaded", `revision upload failed: ${outcome}`);
          await page.getByRole("button", { name: "提交当前版本" }).click();
          await page.getByText("已提交审核", { exact: false }).waitFor({ state: "visible", timeout: 10_000 });
          let entry;
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const mine = await api("/api/v1/me/projects", {}, authorToken);
            assert(mine.response.status === 200, `my projects ${mine.response.status}`);
            entry = JSON.parse(mine.body).items.find(item => item.project.id === pendingId);
            if (entry?.latestSubmission?.status === "approved" && entry.latestSubmission.checkStatus === "done") break;
            await sleep(250);
          }
          assert(entry?.latestSubmission?.status === "approved", `resubmit auto-published: ${JSON.stringify(entry?.latestSubmission)}`);
          assert(entry?.latestSubmission?.checkStatus === "done", "resubmit checker completed");
          await context.close();
        });
      } finally {
        await browser.close();
      }
    } else {
      console.log("skip browser journeys: no cached Chromium");
    }

    await check("origin allowlist", async () => {
      const { response } = await api("/api/v1/auth/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "browser" }),
      });
      assert(response.status === 403, `missing origin ${response.status}`);
    });

    console.log(`E2E ${passed.length}/${passed.length} passed`);
  } finally {
    if (server?.pid) {
      try { process.kill(-server.pid, "SIGTERM"); } catch { /* already exited */ }
    }
    if (process.env.E2E_DEBUG) {
      try { console.error(readFileSync(logFile, "utf8")); } catch { /* no log */ }
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
