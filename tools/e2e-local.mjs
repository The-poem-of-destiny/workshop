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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(root, "apps/worker");
const port = Number(process.env.E2E_PORT ?? 8812);
const base = `http://127.0.0.1:${port}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), "workshop-e2e-"));
// Keep D1/R2/DO state out of the default .wrangler directory so preview servers keep their own data.
const stateDir = process.env.E2E_STATE_DIR ?? mkdtempSync(path.join(os.tmpdir(), "workshop-e2e-state-"));
const ownsStateDir = !process.env.E2E_STATE_DIR;
let server;

const screenshotDir = process.env.E2E_SCREENSHOT_DIR ?? "";
const authorToken = "e2e-author-token";
const ownerToken = "e2e-owner-token";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function wrangler(args, input) {
  const result = spawnSync("pnpm", ["--filter", "@workshop/worker", "exec", "wrangler", ...args], {
    cwd: root,
    encoding: "utf8",
    input,
    env: { ...process.env, CI: "1" },
  });
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

async function screenshot(page, name) {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: true });
}

function chromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  if (!existsSync(cache)) return null;
  for (const name of readdirSync(cache)
    .filter((value) => value.startsWith("chromium-"))
    .sort()
    .reverse()) {
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
  wrangler([
    "d1",
    "migrations",
    "apply",
    "workshop-staging",
    "--local",
    "--persist-to",
    stateDir,
    "--config",
    "wrangler.jsonc",
  ]);
  const logFile = path.join(tmp, "wrangler.log");
  const log = (await import("node:fs")).createWriteStream(logFile);
  server = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--config",
      "wrangler.jsonc",
      "--env",
      "staging",
      "--port",
      String(port),
      "--persist-to",
      stateDir,
      "--log-level",
      "error",
    ],
    {
      cwd: workerDir,
      env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  server.stdout.pipe(log);
  server.stderr.pipe(log);

  try {
    await waitForWorker();

    wrangler([
      "d1",
      "execute",
      "workshop-staging",
      "--local",
      "--persist-to",
      stateDir,
      "--command",
      `
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
    `,
    ]);

    const passed = [];
    const check = async (name, fn) => {
      await fn();
      passed.push(name);
      console.log(`ok ${passed.length} - ${name}`);
    };

    await check("health", async () => {
      const { response, body } = await api("/api/v1/health");
      assert(response.status === 200 && JSON.parse(body).ok === true, "health failed");
    });

    await check("static UI", async () => {
      const response = await fetch(`${base}/`);
      const body = await response.text();
      assert(
        response.status === 200 && response.headers.get("content-type")?.includes("text/html"),
        "root is not HTML",
      );
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
      assert(second.response.status === 200, `list status: ${second.response.status}`);
      assert(second.response.headers.get("cache-control")?.includes("no-store"), "gateway private cache header");
    });

    let project;
    await check("author creates project", async () => {
      const { response, body } = await api(
        "/api/v1/projects",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "E2E Project", description: "e2e", projectType: "角色", tags: ["e2e"] }),
        },
        authorToken,
      );
      assert(response.status === 201, `create ${response.status}: ${body}`);
      project = JSON.parse(body);
      assert(project.project.id && project.workingRevisionId, "create shape");
      const afterCreate = await api("/api/v1/projects");
      assert(afterCreate.response.status === 200, `post-create list ${afterCreate.response.status}`);
    });

    await check("author uploads assets", async () => {
      const worldbook = '{"entries":[{"uid":1,"key":["e2e"],"content":"hello"}]}';
      const wb = await api(
        `/api/v1/projects/${project.project.id}/revisions/${project.workingRevisionId}/files/worldbook`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(worldbook)),
            "if-match": String(project.rowVersion),
          },
          body: worldbook,
        },
        authorToken,
      );
      assert(wb.response.status === 200, `worldbook ${wb.response.status}: ${wb.body}`);
      project.rowVersion = JSON.parse(wb.body).rowVersion;
      // Real 2x2 PNG encoded by FFmpeg (same bytes as packages/domain/src/image.test.ts).
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8ywACLGCSAQANEQED1LYyQAAAAABJRU5ErkJggg==",
        "base64",
      );
      const cover = await api(
        `/api/v1/projects/${project.project.id}/revisions/${project.workingRevisionId}/files/cover`,
        {
          method: "PUT",
          headers: {
            "content-type": "image/png",
            "content-length": String(png.length),
            "if-match": String(project.rowVersion),
          },
          body: png,
        },
        authorToken,
      );
      assert(cover.response.status === 200, `cover ${cover.response.status}: ${cover.body}`);
      project.rowVersion = JSON.parse(cover.body).rowVersion;
    });

    await check("private detail is 404", async () => {
      const { response } = await api(`/api/v1/projects/${project.project.id}`);
      assert(response.status === 404, `private detail ${response.status}`);
      const draft = await api(`/api/v1/projects/${project.project.id}/draft`, {}, authorToken);
      assert(draft.response.status === 200, `author draft ${draft.response.status}`);
    });

    await check("author publishes and acquires through one ticket channel", async () => {
      const visibility = await api(
        `/api/v1/projects/${project.project.id}/visibility`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", "if-match": String(project.rowVersion) },
          body: JSON.stringify({ visibility: "public" }),
        },
        authorToken,
      );
      assert(visibility.response.status === 200, `visibility ${visibility.response.status}: ${visibility.body}`);
      project.rowVersion = JSON.parse(visibility.body).rowVersion;
      const submit = await api(
        `/api/v1/projects/${project.project.id}/revisions/${project.workingRevisionId}/submit`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "if-match": String(project.rowVersion) },
          body: JSON.stringify({ gate: "warn", checkerRevision: "e2e", warningCount: 1, acknowledged: true }),
        },
        authorToken,
      );
      assert(submit.response.status === 201, `submit ${submit.response.status}: ${submit.body}`);
      project.rowVersion = JSON.parse(submit.body).rowVersion;

      let detail;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        detail = await api(`/api/v1/projects/${project.project.id}`);
        if (detail.response.status === 200) break;
        await sleep(250);
      }
      assert(detail?.response.status === 200, `public detail ${detail?.response.status}: ${detail?.body}`);
      assert(JSON.parse(detail.body).id === project.project.id, "public id");
      const indexed = await api(`/api/v1/projects/${project.project.id}/entries`);
      assert(indexed.response.status === 200, `entry index ${indexed.response.status}: ${indexed.body}`);
      const index = JSON.parse(indexed.body);
      assert(
        index.revisionId === project.workingRevisionId &&
          index.entries.length === 1 &&
          index.entries[0].entryKey === "uid:1" &&
          index.entries[0].contentHash === hash("hello") &&
          index.entries[0].contentLength === 5 &&
          !("content" in index.entries[0]),
        "published index must match frozen content without returning bytes",
      );
      const tickets = await api(`/api/v1/projects/${project.project.id}/downloads`, { method: "POST" }, authorToken);
      assert(tickets.response.status === 201, `ticket issue ${tickets.response.status}: ${tickets.body}`);
      const ticket = JSON.parse(tickets.body);
      assert(ticket.revisionId === project.workingRevisionId && ticket.files.length === 1, "release ticket shape");
      const file = await api(ticket.files[0].url, {}, authorToken);
      assert(file.response.status === 200 && file.body.includes("hello"), "ticket bytes");
      const cover = await fetch(`${base}${JSON.parse(detail.body).coverUrl}`);
      assert(cover.status === 200 && cover.headers.get("content-type")?.includes("image/png"), "public cover");
    });

    await check("author creates a second published project for ordering", async () => {
      await sleep(1100);
      const created = await api(
        "/api/v1/projects",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "E2E Sort", description: "ordering", projectType: "事件" }),
        },
        authorToken,
      );
      assert(created.response.status === 201, `sort create ${created.response.status}: ${created.body}`);
      const second = JSON.parse(created.body);
      const worldbook = '{"entries":[{"uid":1,"key":["sort"],"content":"sort body"}]}';
      const upload = await api(
        `/api/v1/projects/${second.project.id}/revisions/${second.workingRevisionId}/files/worldbook`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(worldbook)),
            "if-match": String(second.rowVersion),
          },
          body: worldbook,
        },
        authorToken,
      );
      assert(upload.response.status === 200, `sort upload ${upload.response.status}: ${upload.body}`);
      second.rowVersion = JSON.parse(upload.body).rowVersion;
      const visibility = await api(
        `/api/v1/projects/${second.project.id}/visibility`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", "if-match": String(second.rowVersion) },
          body: JSON.stringify({ visibility: "public" }),
        },
        authorToken,
      );
      assert(visibility.response.status === 200, `sort visibility ${visibility.response.status}: ${visibility.body}`);
      second.rowVersion = JSON.parse(visibility.body).rowVersion;
      const submit = await api(
        `/api/v1/projects/${second.project.id}/revisions/${second.workingRevisionId}/submit`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "if-match": String(second.rowVersion) },
          body: JSON.stringify({ gate: "pass" }),
        },
        authorToken,
      );
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
      const revision = await api(
        `/api/v1/projects/${project.project.id}/revisions`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "if-match": String(rowVersion) },
          body: JSON.stringify({ title: "E2E Project" }),
        },
        authorToken,
      );
      assert(revision.response.status === 201, `successor ${revision.response.status}: ${revision.body}`);
      const next = JSON.parse(revision.body);
      const patched = await api(
        `/api/v1/projects/${project.project.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", "if-match": String(next.rowVersion) },
          body: JSON.stringify({ title: "E2E Project", description: "unified snapshot update" }),
        },
        authorToken,
      );
      assert(patched.response.status === 200, `successor patch ${patched.response.status}: ${patched.body}`);
      const beforeRelease = await api(`/api/v1/projects/${project.project.id}`);
      assert(beforeRelease.response.status === 200, `previous release ${beforeRelease.response.status}`);
      assert(
        JSON.parse(beforeRelease.body).description === "e2e",
        "saving draft metadata leaves public snapshot unchanged",
      );
      const frozen = await api(
        `/api/v1/projects/${project.project.id}/revisions/${next.revisionId}/submit`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "if-match": String(JSON.parse(patched.body).rowVersion) },
          body: JSON.stringify({ gate: "pass" }),
        },
        authorToken,
      );
      assert(frozen.response.status === 201, `metadata submit ${frozen.response.status}: ${frozen.body}`);
      let updated;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        updated = await api(`/api/v1/projects/${project.project.id}`);
        if (updated.response.status === 200 && JSON.parse(updated.body).description === "unified snapshot update")
          break;
        await sleep(250);
      }
      assert(
        updated?.response.status === 200 && JSON.parse(updated.body).description === "unified snapshot update",
        "approved frozen metadata becomes public",
      );
      const publishedDraft = await api(`/api/v1/projects/${project.project.id}/draft`, {}, authorToken);
      assert(publishedDraft.response.status === 200, `published draft ${publishedDraft.response.status}`);
      const immutable = await api(
        `/api/v1/projects/${project.project.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "if-match": String(JSON.parse(publishedDraft.body).rowVersion),
          },
          body: JSON.stringify({ description: "must not mutate a submitted snapshot" }),
        },
        authorToken,
      );
      assert(
        immutable.response.status === 409,
        `submitted metadata is frozen: ${immutable.response.status}: ${immutable.body}`,
      );
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
      assert(
        list.response.status === 200 && JSON.parse(list.body).items.some((item) => item.id === project.project.id),
        "subscription list",
      );
    });

    async function createPending(title, key) {
      const created = await api(
        "/api/v1/projects",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, description: "manual review", projectType: "事件" }),
        },
        authorToken,
      );
      assert(created.response.status === 201, `pending create ${created.response.status}: ${created.body}`);
      const project = JSON.parse(created.body);
      const worldbook = JSON.stringify({ entries: [{ uid: 1, key: [key], content: key }] });
      const upload = await api(
        `/api/v1/projects/${project.project.id}/revisions/${project.workingRevisionId}/files/worldbook`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(worldbook)),
            "if-match": String(project.rowVersion),
          },
          body: worldbook,
        },
        authorToken,
      );
      assert(upload.response.status === 200, `pending upload ${upload.response.status}: ${upload.body}`);
      project.rowVersion = JSON.parse(upload.body).rowVersion;
      const visibility = await api(
        `/api/v1/projects/${project.project.id}/visibility`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", "if-match": String(project.rowVersion) },
          body: JSON.stringify({ visibility: "public" }),
        },
        authorToken,
      );
      assert(
        visibility.response.status === 200,
        `pending visibility ${visibility.response.status}: ${visibility.body}`,
      );
      project.rowVersion = JSON.parse(visibility.body).rowVersion;
      const submit = await api(
        `/api/v1/projects/${project.project.id}/revisions/${project.workingRevisionId}/submit`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "if-match": String(project.rowVersion) },
          body: JSON.stringify({ gate: "missing", acknowledged: true }),
        },
        authorToken,
      );
      assert(submit.response.status === 201, `pending submit ${submit.response.status}: ${submit.body}`);
      return project.project.id;
    }

    let pendingId = "";
    let approveProjectId = "";
    await check("author submits without client checker", async () => {
      pendingId = await createPending("E2E Pending", "pending");
      approveProjectId = await createPending("E2E Approve", "approve");
      const withdrawnId = await createPending("E2E Withdrawn", "withdrawn");
      let withdrawnEntry;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const mine = await api("/api/v1/me/projects", {}, authorToken);
        assert(mine.response.status === 200, `withdraw project list ${mine.response.status}`);
        withdrawnEntry = JSON.parse(mine.body).items.find((item) => item.project.id === withdrawnId);
        if (withdrawnEntry?.latestSubmission?.status === "pending") break;
        await sleep(250);
      }
      assert(
        withdrawnEntry?.latestSubmission?.status === "pending",
        "manual submission reaches withdrawable pending state",
      );
      const withdrawal = await api(
        `/api/v1/projects/${withdrawnId}/submissions/${withdrawnEntry.latestSubmission.id}/withdraw`,
        { method: "POST", headers: { "if-match": String(withdrawnEntry.rowVersion) } },
        authorToken,
      );
      assert(withdrawal.response.status === 200, `withdraw ${withdrawal.response.status}: ${withdrawal.body}`);
      const withdrawn = JSON.parse(withdrawal.body);
      assert(withdrawn.status === "superseded" && withdrawn.withdrawnAt, "withdrawal is explicit and timestamped");
      const history = await api(`/api/v1/me/projects/${withdrawnId}/submissions`, {}, authorToken);
      assert(
        history.response.status === 200 &&
          JSON.parse(history.body).items.some(
            (item) => item.id === withdrawn.submissionId && item.withdrawnAt && item.status === "superseded",
          ),
        "withdrawn frozen submission remains in author history",
      );
      const unpublished = await api(`/api/v1/projects/${withdrawnId}`);
      assert(unpublished.response.status === 404, "withdrawn submission does not become public");
    });

    const executablePath = chromiumExecutable();
    if (executablePath) {
      const browser = await chromium.launch({ headless: true, executablePath });
      const browserDiagnostics = [];
      function observePage(page) {
        page.on("pageerror", (error) => browserDiagnostics.push(`pageerror ${page.url()}: ${error.stack ?? error}`));
        page.on("response", (response) => {
          if (response.status() >= 400) browserDiagnostics.push(`HTTP ${response.status()} ${response.url()}`);
        });
        page.on("requestfailed", (request) =>
          browserDiagnostics.push(`requestfailed ${request.url()}: ${request.failure()?.errorText}`),
        );
      }
      try {
        await check("browser anonymous search and detail", async () => {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          observePage(page);
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.locator(".card").first().waitFor({ state: "visible", timeout: 10_000 });
          if ((await page.locator(".discovery-item").count()) > 0) {
            await page.locator(".discovery-item").first().click();
            await page.locator(".detail").waitFor({ state: "visible" });
            await page.keyboard.press("Escape");
            await page.locator(".detail").waitFor({ state: "hidden" });
          }
          await screenshot(page, "browse-desktop");
          await page.getByRole("searchbox", { name: "搜索" }).fill("E2E Project");
          await page
            .locator(".card", { hasText: "E2E Project" })
            .first()
            .waitFor({ state: "visible", timeout: 10_000 });
          await page.locator(".card", { hasText: "E2E Project" }).first().locator(".card-title").click();
          await page.locator(".detail").waitFor({ state: "visible" });
          await page.getByRole("dialog").getByRole("heading", { name: "E2E Project" }).waitFor();
          await screenshot(page, "detail-desktop");
          assert(
            (await page
              .locator(".detail")
              .getByRole("button", { name: /^(安装|更新|卸载|下载)$/ })
              .count()) === 0,
            "anonymous detail exposes no install or download action",
          );
          const authorResults = page.waitForResponse((response) => {
            const url = new URL(response.url());
            return url.pathname === "/api/v1/projects" && url.searchParams.get("authorId") === "e2e-author";
          });
          await page.locator(".detail .author.link").click();
          const filteredResponse = await authorResults;
          assert(filteredResponse.ok(), "author filter request succeeds");
          const filtered = await filteredResponse.json();
          assert(
            filtered.items.some((item) => item.id === project.project.id),
            "author filter includes the published project",
          );
          assert(
            filtered.items.every((project) => project.author.id === "e2e-author"),
            "author filter excludes other authors",
          );
          await page.locator(".detail").waitFor({ state: "hidden" });
          await page.locator(".sidebar-author button").click();
          await page.locator(".sidebar-author").waitFor({ state: "hidden" });
          await page.close();
        });

        await check("browser mobile browse and detail", async () => {
          const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
          observePage(page);
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.locator(".card").first().waitFor({ state: "visible", timeout: 10_000 });
          await screenshot(page, "browse-mobile");
          await page.locator(".card").first().locator(".card-title").click();
          await page.locator(".detail").waitFor({ state: "visible" });
          await screenshot(page, "detail-mobile");
          await page.keyboard.press("Escape");
          await page.locator(".detail").waitFor({ state: "hidden" });
          await page.close();
        });

        await check("browser sort tabs reorder actual cards", async () => {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          observePage(page);
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.getByRole("searchbox", { name: "搜索" }).fill("E2E");
          await page.locator(".card", { hasText: "E2E Sort" }).first().waitFor({ state: "visible", timeout: 10_000 });
          const sortRequest = (value) =>
            page.waitForResponse((response) => {
              const url = new URL(response.url());
              return url.pathname === "/api/v1/projects" && url.searchParams.get("sort") === value;
            });
          const sortButton = (label) => page.locator(".sorts").getByRole("button", { name: label, exact: true });
          for (const [sort, label, metric] of [
            ["published", "发布时间", (item) => Date.parse(item.publishedAt)],
            ["updated", "最近更新", (item) => Date.parse(item.updatedAt)],
            ["downloads", "下载", (item) => item.counts.downloads],
            ["likes", "点赞", (item) => item.counts.likes],
          ]) {
            const [response] = await Promise.all([sortRequest(sort), sortButton(label).click()]);
            assert(response.ok(), `${sort} sort ${response.status()}`);
            const result = await response.json();
            assert(result.items.length === 2, `${sort} keeps both matching public projects`);
            for (let index = 1; index < result.items.length; index += 1) {
              assert(
                metric(result.items[index - 1]) >= metric(result.items[index]),
                `${sort} API is ordered by actual release metric`,
              );
            }
            const expected = result.items.map((item) => item.title);
            await page.waitForFunction(
              (titles) =>
                JSON.stringify([...document.querySelectorAll(".card h3")].map((node) => node.textContent.trim())) ===
                JSON.stringify(titles),
              expected,
              { timeout: 10_000 },
            );
            assert(
              JSON.stringify(await page.locator(".card h3").allTextContents()) === JSON.stringify(expected),
              `${sort} cards match complete API order`,
            );
            if (sort === "downloads")
              assert(result.items[0].id === project.project.id, "downloaded release ranks first");
          }
          await page.close();
        });

        await check("browser detail interactions", async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          await context.addInitScript((token) => sessionStorage.setItem("cw_session_token", token), authorToken);
          const page = await context.newPage();
          observePage(page);
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.locator(".card", { hasText: "E2E Project" }).first().locator(".card-title").click();
          await page.locator(".detail").waitFor({ state: "visible" });
          const subscribe = page.locator(".detail").getByRole("button", { name: /订阅/ });
          await page.waitForFunction(() => {
            const button = [...document.querySelectorAll(".detail button")].find((element) =>
              element.textContent?.includes("订阅"),
            );
            return button && !button.disabled;
          });
          if ((await subscribe.textContent())?.trim() === "订阅") {
            await subscribe.click();
            await page.locator(".detail").getByRole("button", { name: "已订阅", exact: true }).waitFor();
          }
          const like = page.locator(".detail").getByRole("button", { name: "点赞", exact: true, pressed: false });
          await like.click();
          await page.locator(".detail").getByRole("button", { name: "已点赞", exact: true, pressed: true }).waitFor();
          await page.locator(".detail").getByRole("button", { name: "已点赞", exact: true, pressed: true }).click();
          await like.waitFor();
          await context.close();
        });

        await check("browser author workspace", async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          await context.addInitScript((token) => sessionStorage.setItem("cw_session_token", token), authorToken);
          const page = await context.newPage();
          observePage(page);
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: "我的项目", exact: true }).click();
          await page.locator(".workspace-projects").waitFor({ state: "visible", timeout: 10_000 });
          await page.locator(".workspace-projects").getByRole("button", { name: "新建项目", exact: true }).click();
          await page.locator(".workspace-create").waitFor({ state: "visible", timeout: 10_000 });
          await page.locator(".workspace-create").getByRole("button", { name: "返回我的项目", exact: true }).click();
          await page.locator(".workspace-projects").waitFor({ state: "visible", timeout: 10_000 });
          await page.getByText("E2E Project", { exact: true }).first().click();
          const editor = page.getByRole("dialog", { name: "E2E Project · 编辑任务", exact: true });
          await editor
            .getByRole("button", { name: "资料、封面与内容统一送审", exact: true })
            .waitFor({ state: "visible" });
          await screenshot(page, "author-workspace");
          await editor.getByRole("button", { name: "返回我的项目", exact: true }).click();
          await editor.waitFor({ state: "hidden" });
          await page.getByRole("button", { name: "我的订阅", exact: true }).click();
          await page.getByText("E2E Project", { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
          await context.close();
        });

        await check("browser owner admin tools", async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          await context.addInitScript((token) => sessionStorage.setItem("cw_session_token", token), ownerToken);
          const page = await context.newPage();
          observePage(page);
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: "管理", exact: true }).click();
          const management = page.getByRole("navigation", { name: "管理任务" });
          await management.getByRole("button", { name: /站点设置/ }).click();
          await page
            .getByRole("button", { name: "保存站点设置", exact: true })
            .waitFor({ state: "visible", timeout: 10_000 });
          await screenshot(page, "admin-tools");
          await page.getByRole("button", { name: "保存站点设置", exact: true }).click();
          const [save] = await Promise.all([
            page.waitForResponse(
              (response) =>
                new URL(response.url()).pathname === "/api/v1/site" && response.request().method() === "PUT",
            ),
            page.getByRole("button", { name: "确认执行", exact: true }).click(),
          ]);
          assert(save.ok(), `site save ${save.status()}: ${await save.text()}`);
          await page.getByRole("button", { name: "← 工具索引", exact: true }).click();
          await management.getByRole("button", { name: /成员权限/ }).click();
          await page.getByRole("heading", { name: "成员权限", exact: true }).waitFor({ state: "visible" });
          await screenshot(page, "admin-members");
          await page.getByRole("button", { name: "← 工具索引", exact: true }).click();
          await management.getByRole("button", { name: /审计日志/ }).click();
          await page.getByRole("heading", { name: "审计日志", exact: true }).first().waitFor({ state: "visible" });
          await screenshot(page, "admin-audit");
          await context.close();
        });

        await check("browser admin approves with reason", async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          await context.addInitScript((token) => sessionStorage.setItem("cw_session_token", token), ownerToken);
          const page = await context.newPage();
          observePage(page);
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: "审核台", exact: true }).click();
          const item = page.getByTestId("review-queue-item").filter({ hasText: "E2E Approve" }).first();
          await item.waitFor({ state: "visible", timeout: 15_000 });
          await item.click();
          const task = page.getByRole("dialog", { name: /^审核 · E2E Approve ·/ });
          await task.getByRole("button", { name: "返回队列", exact: true }).waitFor({ state: "visible" });
          await screenshot(page, "review-detail");
          await task.getByTestId("review-approve").click();
          await page.locator(".review-reason textarea").fill("e2e approval reason");
          const [review] = await Promise.all([
            page.waitForResponse((response) => {
              const url = new URL(response.url());
              return (
                /\/api\/v1\/admin\/submissions\/[^/]+\/review$/.test(url.pathname) &&
                response.request().method() === "POST"
              );
            }),
            page.getByRole("button", { name: /^确认(人工)?批准$/ }).click(),
          ]);
          assert(review.ok(), `approve ${review.status()}: ${await review.text()}`);
          await page
            .getByTestId("review-queue-item")
            .filter({ hasText: "E2E Approve" })
            .waitFor({ state: "hidden", timeout: 10_000 });
          let detail;
          for (let attempt = 0; attempt < 40; attempt += 1) {
            detail = await api(`/api/v1/projects/${approveProjectId}`);
            if (detail.response.status === 200) break;
            await sleep(250);
          }
          assert(detail?.response.status === 200, `approved project public: ${detail?.response.status}`);
          await context.close();
        });

        await check("browser admin queue rejects without reason", async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          await context.addInitScript((token) => sessionStorage.setItem("cw_session_token", token), ownerToken);
          const page = await context.newPage();
          observePage(page);
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: "审核台", exact: true }).click();
          const item = page.getByTestId("review-queue-item").filter({ hasText: "E2E Pending" }).first();
          await item.waitFor({ state: "visible", timeout: 15_000 });
          await item.click();
          const task = page.getByRole("dialog", { name: /^审核 · E2E Pending ·/ });
          await task.getByTestId("review-reject").click();
          const rejectConfirm = page.getByRole("button", { name: /^确认拒绝$/ });
          await rejectConfirm.waitFor({ state: "visible", timeout: 10_000 });
          assert(
            (await rejectConfirm.isDisabled()) &&
              (await page.getByTestId("review-queue-item").filter({ hasText: "E2E Pending" }).count()) > 0,
            "reject without a reason keeps the submission queued",
          );
          await page.locator(".review-reason textarea").fill("e2e rejection reason");
          assert(await rejectConfirm.isEnabled(), "reject reason enables confirmation");
          const [review] = await Promise.all([
            page.waitForResponse((response) => {
              const url = new URL(response.url());
              return (
                /\/api\/v1\/admin\/submissions\/[^/]+\/review$/.test(url.pathname) &&
                response.request().method() === "POST"
              );
            }),
            rejectConfirm.click(),
          ]);
          assert(review.ok(), `reject ${review.status()}: ${await review.text()}`);
          await page
            .getByTestId("review-queue-item")
            .filter({ hasText: "E2E Pending" })
            .waitFor({ state: "hidden", timeout: 10_000 });
          let entry;
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const mine = await api("/api/v1/me/projects", {}, authorToken);
            assert(mine.response.status === 200, `my projects ${mine.response.status}`);
            entry = JSON.parse(mine.body).items.find((item) => item.project.id === pendingId);
            if (entry?.latestSubmission?.status === "rejected") break;
            await sleep(250);
          }
          assert(
            entry?.latestSubmission?.status === "rejected",
            `rejected: ${JSON.stringify(entry?.latestSubmission)}`,
          );
          assert(
            (entry?.latestSubmission?.reason ?? "").includes("e2e rejection reason"),
            "rejection reason persisted",
          );
          await context.close();
        });

        await check("browser author revises rejected project and resubmits", async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          await context.addInitScript((token) => sessionStorage.setItem("cw_session_token", token), authorToken);
          const page = await context.newPage();
          observePage(page);
          await page.goto(`${base}/`, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: "我的项目", exact: true }).click();
          await page.getByText("E2E Pending", { exact: true }).first().click();
          const statusBanner = page.locator(".workspace-banner.is-danger");
          await statusBanner.waitFor({ state: "visible", timeout: 10_000 });
          const bannerText = (await statusBanner.textContent()) ?? "";
          assert(
            bannerText.includes("已被退回") && bannerText.includes("退回原因"),
            `rejected submission rendered: ${bannerText}`,
          );
          const [revisionResponse] = await Promise.all([
            page.waitForResponse(
              (response) => response.url().endsWith("/revisions") && response.request().method() === "POST",
            ),
            page.getByRole("button", { name: "新建版本" }).click(),
          ]);
          assert(
            revisionResponse.status() === 201,
            `successor response ${revisionResponse.status()}: ${await revisionResponse.text()}`,
          );
          const fileInputReady = () =>
            page.waitForFunction(() => {
              const input = document.querySelector('input[type="file"][accept*=".json"]');
              return input instanceof HTMLInputElement && !input.disabled;
            });
          await fileInputReady();
          const [uploadResponse] = await Promise.all([
            page.waitForResponse((response) => {
              const url = new URL(response.url());
              return /\/files\/worldbook$/.test(url.pathname) && response.request().method() === "PUT";
            }),
            page
              .locator('input[type="file"][accept*=".json"]')
              .first()
              .setInputFiles({
                name: "worldbook.json",
                mimeType: "application/json",
                buffer: Buffer.from(
                  JSON.stringify({ entries: [{ uid: 2, key: ["revised"], content: "revised pending" }] }),
                ),
              })
              .then(() => page.getByRole("button", { name: "上传世界书", exact: true }).click()),
          ]);
          assert(uploadResponse.ok(), `revision upload ${uploadResponse.status()}: ${await uploadResponse.text()}`);
          await fileInputReady();
          const [submitResponse] = await Promise.all([
            page.waitForResponse((response) => {
              const url = new URL(response.url());
              return /\/submit$/.test(url.pathname) && response.request().method() === "POST";
            }),
            page
              .getByRole("dialog", { name: "E2E Pending · 编辑任务", exact: true })
              .getByRole("button", { name: "资料、封面与内容统一送审", exact: true })
              .click(),
          ]);
          assert(
            submitResponse.status() === 201,
            `resubmit ${submitResponse.status()}: ${await submitResponse.text()}`,
          );
          let entry;
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const mine = await api("/api/v1/me/projects", {}, authorToken);
            assert(mine.response.status === 200, `my projects ${mine.response.status}`);
            entry = JSON.parse(mine.body).items.find((item) => item.project.id === pendingId);
            if (entry?.latestSubmission?.status === "approved" && entry.latestSubmission.checkStatus === "done") break;
            await sleep(250);
          }
          assert(
            entry?.latestSubmission?.status === "approved",
            `resubmit auto-published: ${JSON.stringify(entry?.latestSubmission)}`,
          );
          assert(entry?.latestSubmission?.checkStatus === "done", "resubmit checker completed");
          await context.close();
        });
      } catch (error) {
        console.error(browserDiagnostics.join("\n"));
        for (const context of browser.contexts()) {
          for (const [index, page] of context.pages().entries()) {
            console.error(
              `Browser failure DOM ${page.url()}: ${((await page.locator("body").textContent()) ?? "").slice(0, 12_000)}`,
            );
            await screenshot(page, `failure-${index}`);
          }
        }
        throw error;
      } finally {
        await browser.close();
      }
    } else {
      throw new Error(
        "Browser E2E requires cached Chromium or PLAYWRIGHT_CHROMIUM_EXECUTABLE; refusing to skip journeys",
      );
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
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        /* already exited */
      }
    }
    if (process.env.E2E_DEBUG) {
      try {
        console.error(readFileSync(logFile, "utf8"));
      } catch {
        /* no log */
      }
    }
    rmSync(tmp, { recursive: true, force: true });
    if (ownsStateDir) rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
