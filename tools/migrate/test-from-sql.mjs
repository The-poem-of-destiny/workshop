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
  await mkdir(path.join(r2, "projects", "p1"), { recursive: true });
  await writeFile(path.join(r2, "projects", "p1", "cover.png"), Buffer.from("89504e47", "hex"));
  await writeFile(path.join(r2, "projects", "p1", "regex-p1.json"), "[]");
  await writeFile(path.join(r2, "projects", "p1", "project-p1.json"), '{"entries":[]}');
  await writeFile(
    source,
    `
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, is_admin INTEGER DEFAULT 0);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, author_id TEXT, cover_image TEXT, download_url TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE admins (user_id TEXT PRIMARY KEY);
    CREATE TABLE super_admins (user_id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('u1','owner',1);
    INSERT INTO super_admins VALUES ('u1');
    INSERT INTO projects VALUES ('p1','Project','u1','projects/p1/cover.png','https://example.test/api/files/projects/p1/project-p1.json','2024-01-01','2024-01-02');
  `,
  );

  const run = spawnSync("python3", [path.join(here, "from_d1_sql.py"), source, r2, out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /3 assets, 0 missing R2 objects, 0 unrecognized fields/);

  const assets = JSON.parse(await readFile(path.join(out, "assets.json"), "utf8"));
  assert.deepEqual(assets.map((asset) => asset.kind).sort(), ["cover", "regex", "worldbook"]);
  assert.equal(assets.find((asset) => asset.kind === "cover").r2_key, "projects/p1/cover.png");
  assert.equal(assets.find((asset) => asset.kind === "regex").r2_key, "projects/p1/regex-p1.json");
  assert.equal(
    assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)),
    true,
  );

  const users = JSON.parse(await readFile(path.join(out, "users.json"), "utf8"));
  assert.equal(users[0].role, "owner", "super_admin becomes owner");
  console.log("sql export tests passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
