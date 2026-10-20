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
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    });

    await check("public list", async () => {
      const { response, body } = await api("/api/v1/projects");
      assert(response.status === 200 && Array.isArray(JSON.parse(body).items), "list shape");
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

    let submissionId;
    await check("author publishes and submits", async () => {
      const visibility = await api(`/api/v1/projects/${project.project.id}/visibility`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "if-match": "1" },
        body: JSON.stringify({ visibility: "public" }),
      }, authorToken);
      assert(visibility.response.status === 200, `visibility ${visibility.response.status}: ${visibility.body}`);
      const submit = await api(`/api/v1/projects/${project.project.id}/revisions/${project.workingRevisionId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gate: "warn", checkerRevision: "e2e" }),
      }, authorToken);
      assert(submit.response.status === 201, `submit ${submit.response.status}: ${submit.body}`);
      submissionId = JSON.parse(submit.body).submissionId;
    });

    await check("owner approves and public reads", async () => {
      const review = await api(`/api/v1/admin/submissions/${submissionId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve", checkerVersion: "e2e" }),
      }, ownerToken);
      assert(review.response.status === 201, `review ${review.response.status}: ${review.body}`);
      const detail = await api(`/api/v1/projects/${project.project.id}`);
      assert(detail.response.status === 200, `public detail ${detail.response.status}: ${detail.body}`);
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

    await check("download is idempotent", async () => {
      const first = await api(`/api/v1/projects/${project.project.id}/downloads`, { method: "POST" }, authorToken);
      const second = await api(`/api/v1/projects/${project.project.id}/downloads`, { method: "POST" }, authorToken);
      assert(first.response.status === 204 && second.response.status === 204, "download status");
      const detail = await api(`/api/v1/projects/${project.project.id}`);
      assert(JSON.parse(detail.body).counts.downloads === 1, "download counted exactly once");
    });

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
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
