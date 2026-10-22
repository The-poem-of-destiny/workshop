#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = await mkdtemp(path.join(os.tmpdir(), "workshop-sql-export-"));
try {
  const source = path.join(dir, "source.sql");
  const r2 = path.join(dir, "r2");
  const out = path.join(dir, "out");
  await mkdir(path.join(r2, "projects", "public"), { recursive: true });
  await writeFile(path.join(r2, "projects", "public", "worldbook.json"), '{"entries":[{"content":"ok"}]}');
  await writeFile(path.join(r2, "projects", "public", "regex-public.json"), '[{"scriptName":"r","replaceString":"x"}]');
  await writeFile(
    source,
    `
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, is_admin INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, author_id TEXT, status TEXT, is_published INTEGER, visibility INTEGER, download_url TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE admins (user_id TEXT PRIMARY KEY);
      INSERT INTO users VALUES ('u1','owner',1,'2024-01-01','2024-01-02');
      INSERT INTO projects VALUES ('public','Public','u1','approved',1,1,'projects/public/worldbook.json','2024-01-01','2024-01-02');
      INSERT INTO projects VALUES ('draft','Draft','u1','approved',0,1,NULL,'2024-01-01','2024-01-02');
    `,
  );
  const run = spawnSync("python3", [path.join(here, "from_d1_sql.py"), source, r2, out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /exported 1 public projects, 1 member authors, 2 assets/);
  const projects = JSON.parse(await readFile(path.join(out, "projects.json"), "utf8"));
  assert.deepEqual(
    projects.map((project) => project.id),
    ["public"],
  );
  const users = JSON.parse(await readFile(path.join(out, "users.json"), "utf8"));
  assert.deepEqual(
    users,
    [{ id: "u1", username: "owner", created_at: "2024-01-01", updated_at: "2024-01-02" }],
    "raw export omits legacy roles",
  );
  const assets = JSON.parse(await readFile(path.join(out, "assets.json"), "utf8"));
  assert.deepEqual(assets.map((asset) => asset.kind).sort(), ["regex", "worldbook"]);
  assert.equal(
    assets.every((asset) => typeof asset.content_base64 === "string" && /^[a-f0-9]{64}$/.test(asset.sha256)),
    true,
  );
  console.log("sql export tests passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
