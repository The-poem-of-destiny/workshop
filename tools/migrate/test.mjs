#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sealImportPackage } from "./import-package.mjs";
import { extract, migrationSql, transform } from "./lib.mjs";
import { buildManifest } from "./r2-copy.mjs";
import { verify } from "./validation.mjs";
import { stableStringify } from "./values.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const asset = (project_id, kind, r2_key, value) => {
  const bytes = Buffer.from(value);
  return {
    project_id,
    kind,
    r2_key,
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    mime: "application/json",
    content_base64: bytes.toString("base64"),
  };
};

const dir = await mkdtemp(path.join(os.tmpdir(), "workshop-migration-"));
try {
  const source = path.join(dir, "source");
  await mkdir(source);
  await writeFile(
    path.join(source, "users.json"),
    JSON.stringify([
      {
        id: "author",
        username: "author",
        global_name: "Author",
        is_admin: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: "former-admin",
        username: "admin",
        is_admin: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    ]),
  );
  await writeFile(
    path.join(source, "projects.json"),
    JSON.stringify([
      {
        id: "public",
        name: "Published",
        author_id: "author",
        status: "approved",
        is_published: 1,
        visibility: 1,
        tags: '["worldbook"]',
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
        latest_approved_at: "2024-01-01T12:00:00Z",
        reviewed_at: "2024-01-01T06:00:00Z",
      },
      {
        id: "draft",
        name: "Draft",
        author_id: "author",
        status: "approved",
        is_published: 0,
        visibility: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: "private",
        name: "Private",
        author_id: "author",
        status: "approved",
        is_published: 1,
        visibility: 0,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: "pending",
        name: "Pending",
        author_id: "author",
        status: "pending",
        is_published: 1,
        visibility: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: "malformed",
        name: "Malformed",
        author_id: "author",
        status: "approved",
        is_published: 1,
        visibility: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    ]),
  );
  const worldbook = '{"entries":{"first":{"uid":"entry-1","comment":"世界","content":"猫"}}}';
  const regex = '[{"id":"regex-1","scriptName":"Script","findRegex":"a","replaceString":"替换"}]';
  const broken = asset("malformed", "worldbook", "projects/malformed/worldbook.json", "not json");
  await writeFile(
    path.join(source, "assets.json"),
    JSON.stringify([
      asset("public", "worldbook", "projects/public/worldbook.json", worldbook),
      asset("public", "regex", "projects/public/regex-public.json", regex),
      asset("public", "cover", "projects/public/cover.png", "cover-bytes"),
      broken,
    ]),
  );

  const first = transform(await extract(source));
  const second = transform(await extract(source));
  assert.equal(stableStringify(first), stableStringify(second), "unchanged explicit export is deterministic");
  assert.deepEqual(
    first.tables.projects.map((project) => project.id),
    ["public"],
    "only public published releases survive",
  );
  assert.equal(first.tables.projects[0].published_at, "2024-01-01T12:00:00Z");
  assert.equal(first.tables.projects[0].published_updated_at, "2024-01-01T12:00:00Z");
  const fallbackSource = await extract(source);
  const fallbackProject = fallbackSource.tables.projects.find((row) => row.id === "public");
  delete fallbackProject.latest_approved_at;
  assert.equal(transform(fallbackSource).tables.projects[0].published_updated_at, "2024-01-01T06:00:00Z");
  delete fallbackProject.reviewed_at;
  assert.equal(transform(fallbackSource).tables.projects[0].published_updated_at, "2024-01-02T00:00:00Z");
  assert.deepEqual(
    first.tables.users.map((user) => [user.id, user.role]),
    [["author", "member"]],
    "authors retain identity without legacy privilege",
  );
  assert.equal(first.tables.project_revisions[0].worldbook_count, 1);
  assert.equal(first.tables.project_revisions[0].regex_count, 1);
  assert.deepEqual(
    first.tables.revision_entry_index.map((entry) => [entry.kind, entry.entry_key, entry.content_length]).sort(),
    [
      ["regex", "id:regex-1", 2],
      ["worldbook", "object:first", 1],
    ],
  );
  assert.ok(
    first.meta.skipped.some(
      (item) => item.project_id === "malformed" && item.reason.startsWith("worldbook_invalid_worldbook_content:"),
    ),
  );
  assert.equal(verify(first).ok, true, JSON.stringify(verify(first).mismatches));

  const cover = first.tables.assets.find((row) => row.kind === "cover");
  assert.ok(cover.r2_key.startsWith("covers/"), "imported covers must be reachable through the public asset route");

  const missingKeySource = await extract(source);
  missingKeySource.tables.assets.find((row) => row.project_id === "public" && row.kind === "worldbook").r2_key = "";
  const missingKeyTarget = transform(missingKeySource);
  assert.equal(
    missingKeyTarget.tables.projects.some((row) => row.id === "public"),
    false,
    "a missing worldbook key must reject the release rather than publish only its regex",
  );
  assert.ok(
    missingKeyTarget.meta.skipped.some(
      (row) => row.project_id === "public" && row.reason === "asset_worldbook_missing_r2_key",
    ),
  );

  const sharedSource = await extract(source);
  const sharedProject = { ...sharedSource.tables.projects.find((row) => row.id === "public"), id: "shared" };
  sharedSource.tables.projects.push(sharedProject);
  sharedSource.tables.assets.push({
    ...sharedSource.tables.assets.find((row) => row.project_id === "public" && row.kind === "worldbook"),
    project_id: "shared",
  });
  const sharedTarget = transform(sharedSource);
  assert.equal(verify(sharedTarget).ok, true);
  const sharedManifest = buildManifest(sharedTarget);
  assert.equal(
    sharedManifest.objects.filter((row) => row.targetKey === "projects/public/worldbook.json").length,
    1,
    "shared immutable objects are copied once, not rejected as duplicate destinations",
  );
  const conflict = structuredClone(sharedTarget);
  conflict.tables.assets.find((row) => row.project_id === "shared").sha256 = "f".repeat(64);
  assert.throws(() => buildManifest(conflict), /conflicting shared object/);

  const alteredHash = structuredClone(first);
  alteredHash.tables.assets[0].sha256 = "0".repeat(64);
  assert.equal(verify(alteredHash).ok, false, "asset SHA changes are rejected");
  const alteredIndex = structuredClone(first);
  alteredIndex.tables.revision_entry_index.pop();
  assert.equal(verify(alteredIndex).ok, false, "incomplete persisted entry indexes are rejected");

  const packageDir = path.join(dir, "package");
  const isolatedCwd = path.join(dir, "isolated");
  await mkdir(packageDir);
  await mkdir(isolatedCwd);
  await writeFile(path.join(packageDir, "target.json"), JSON.stringify(first));
  const manifest = buildManifest(first);
  await writeFile(path.join(packageDir, "target.json.assets.json"), JSON.stringify(manifest));
  const sourceAssets = (await extract(source)).tables.assets;
  for (const object of manifest.objects) {
    const file = path.join(packageDir, "r2-target", object.targetKey);
    const original = sourceAssets.find((row) => row.r2_key === object.sourceKey);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(original.content_base64, "base64"));
  }
  const sqlFile = path.join(packageDir, "import.sql");
  const approvedSql = migrationSql(first);
  for (const altered of ["DELETE FROM projects;", `${approvedSql}\nDELETE FROM users;`, migrationSql(sharedTarget)]) {
    await writeFile(sqlFile, altered);
    assert.throws(() => sealImportPackage({ packageDir, isolatedCwd }), /does not exactly match/);
  }
  await writeFile(sqlFile, approvedSql);
  const sealed = sealImportPackage({ packageDir, isolatedCwd });
  await writeFile(sqlFile, "DELETE FROM users;");
  await writeFile(path.join(packageDir, "target.json"), "{}");
  const changedAsset = manifest.objects[0];
  await writeFile(path.join(packageDir, "r2-target", changedAsset.targetKey), "changed after verification");
  assert.equal(await readFile(sealed.sqlPath, "utf8"), approvedSql, "execution cannot reread mutable package SQL");
  assert.equal(sealed.target.tables.projects[0].id, "public", "verification retains the parsed target snapshot");
  assert.equal(
    sha256(await readFile(path.join(sealed.sourceDir, changedAsset.targetKey))),
    changedAsset.sha256,
    "upload source is the verified asset snapshot, not the mutable package",
  );
  const execution = spawnSync(
    "python3",
    [
      "-c",
      `
import json, sqlite3, sys
target = json.loads(sys.stdin.read())
db = sqlite3.connect(':memory:')
for table, rows in target['tables'].items():
    columns = sorted({key for row in rows for key in row})
    if not columns:
        continue
    definitions = [json.dumps(key) + (' PRIMARY KEY' if key == 'id' else '') for key in columns]
    db.execute('CREATE TABLE ' + json.dumps(table) + ' (' + ','.join(definitions) + ')')
db.execute("INSERT INTO users (id, username, role) VALUES ('author', 'existing identity', 'owner')")
db.execute("INSERT INTO projects (id, title) VALUES ('old-project', 'Do not change')")
db.executescript(open(sys.argv[1]).read())
assert db.execute("SELECT username, role FROM users WHERE id='author'").fetchone() == ('existing identity', 'owner')
assert db.execute("SELECT title FROM projects WHERE id='old-project'").fetchone() == ('Do not change',)
assert db.execute("SELECT title FROM projects WHERE id='public'").fetchone() == ('Published',)
assert db.execute("SELECT published_updated_at FROM projects WHERE id='public'").fetchone() == ('2024-01-01T12:00:00Z',)
assert db.execute('SELECT count(*) FROM project_revisions').fetchone()[0] == 1
assert db.execute('SELECT count(*) FROM assets').fetchone()[0] == 3
`,
      sealed.sqlPath,
    ],
    { input: JSON.stringify(first), encoding: "utf8" },
  );
  assert.equal(
    execution.status,
    0,
    `approved SQL must insert imported data without changing existing state: ${execution.stderr}`,
  );

  const migration = spawnSync(
    "python3",
    [
      "-c",
      `
import sqlite3, sys
db = sqlite3.connect(':memory:')
db.executescript("""
CREATE TABLE projects (id TEXT PRIMARY KEY, published_revision_id TEXT, published_at TEXT, updated_at TEXT);
CREATE TABLE project_revisions (id TEXT PRIMARY KEY, created_at TEXT);
CREATE TABLE submissions (revision_id TEXT, status TEXT, resolved_at TEXT);
INSERT INTO project_revisions VALUES ('r1', '2020-01-01'), ('r2', '2020-02-01'), ('r3', '2020-03-01');
INSERT INTO projects VALUES ('history', 'r1', '2020-01-02', '2025-01-01'),
  ('published', 'r2', '2020-02-02', '2025-02-01'),
  ('revision', 'r3', NULL, '2025-03-01'), ('draft', NULL, NULL, '2025-04-01');
INSERT INTO submissions VALUES ('r1', 'approved', '2020-01-03'),
  ('r1', 'approved', '2020-01-04'), ('r1', 'rejected', '2025-01-01'),
  ('r2', 'pending', '2025-02-01');
""")
for migration in sys.argv[1:]:
    with open(migration, encoding='utf-8') as source:
        db.executescript(source.read())
assert db.execute("SELECT id, published_updated_at FROM projects ORDER BY id").fetchall() == [
    ('draft', None), ('history', '2020-01-04'), ('published', '2020-02-02'), ('revision', '2020-03-01')]
assert db.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%cache_epoch%'").fetchall() == []
`,
      fileURLToPath(new URL("../../apps/worker/migrations/0025_remove_public_cache_epoch.sql", import.meta.url)),
      fileURLToPath(new URL("../../apps/worker/migrations/0026_published_updated_at.sql", import.meta.url)),
    ],
    { encoding: "utf8" },
  );
  assert.equal(migration.status, 0, `historical publication timestamps must survive migration: ${migration.stderr}`);

  console.log("migration tests passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
