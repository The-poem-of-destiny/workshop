#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migrations = readdirSync("apps/worker/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const schema = migrations.map((file) => readFileSync(`apps/worker/migrations/${file}`, "utf8")).join("\n");
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
db.exec(schema);

const expectedTables = [
  "users",
  "sessions",
  "oauth_flows",
  "projects",
  "project_versions",
  "assets",
  "submissions",
  "manual_reviews",
  "project_likes",
  "project_subscriptions",
  "project_ratings",
  "download_daily_stats",
  "project_metrics_daily",
  "recommendation_batches",
  "recommendation_batch_activations",
  "recommendation_batch_eligibility",
  "recommendations",
  "site_settings",
  "audit_events",
  "project_search",
  "project_search_short",
  "project_search_tags",
  "automated_reviews",
  "project_change_signals",
];

const tables = new Set(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
    .all()
    .map((row) => row.name),
);
for (const table of expectedTables) {
  if (!tables.has(table)) throw new Error(`missing table ${table}`);
}

const now = "2026-10-21T00:00:00.000Z";
db.prepare(
  "INSERT INTO users (id, username, global_name, role, created_at, updated_at) VALUES (?, ?, ?, 'member', ?, ?)",
).run("u1", "author", "作者", now, now);

db.prepare(`INSERT INTO projects
  (id, author_id, visibility, created_at, updated_at)
  VALUES (?, ?, 'public', ?, ?)`).run("p1", "u1", now, now);

db.prepare(`INSERT INTO project_versions
  (id, project_id, version_no, title, description, project_type, included_types, tags, created_by, created_at)
  VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`).run(
  "r1",
  "p1",
  "命定之诗测试项目",
  "描述",
  "系统核心",
  '["角色","玩法"]',
  '["合集","cbz"]',
  "u1",
  now,
);
db.prepare("UPDATE projects SET published_version_id='r1', working_version_id='r1' WHERE id='p1'").run();

db.prepare(`INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
  VALUES (?, ?, ?, 'worldbook', ?, ?, 10, 'application/json', ?)`).run(
  "a1",
  "p1",
  "r1",
  "projects/p1/versions/r1/worldbook.json",
  "0".repeat(64),
  now,
);

db.prepare(`INSERT INTO submissions (id, project_id, version_id, submitted_by, submitted_at)
  VALUES (?, ?, ?, ?, ?)`).run("s1", "p1", "r1", "u1", now);
db.prepare(
  "INSERT INTO automated_reviews(submission_id,status,client_gate) VALUES ('s1','needs_human','missing')",
).run();

db.prepare("INSERT INTO project_likes (project_id, user_id) VALUES (?, ?)").run("p1", "u1");
db.prepare("INSERT INTO project_subscriptions (project_id, user_id) VALUES (?, ?)").run("p1", "u1");
const counters = db.prepare("SELECT likes_count, subscriptions_count FROM projects WHERE id = ?").get("p1");
if (counters.likes_count !== 1 || counters.subscriptions_count !== 1) {
  throw new Error(`counter triggers failed: ${JSON.stringify(counters)}`);
}

const fts = db.prepare("SELECT rowid FROM project_search WHERE project_search MATCH ?").all("命定之");
if (fts.length !== 1) throw new Error(`trigram search returned ${fts.length} rows`);

const short = db.prepare("SELECT rowid FROM project_search_short WHERE project_search_short MATCH ?").all("命 定");
if (short.length !== 1) throw new Error(`short search returned ${short.length} rows`);

let duplicatePendingRejected = false;
try {
  db.prepare(`INSERT INTO submissions (id, project_id, version_id, submitted_by, submitted_at)
    VALUES (?, ?, ?, ?, ?)`).run("s2", "p1", "r1", "u1", now);
} catch {
  duplicatePendingRejected = true;
}
if (!duplicatePendingRejected) throw new Error("second pending submission was accepted");

function rejects(sql, message) {
  let rejected = false;
  try {
    db.exec(sql);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(message);
}
db.prepare("INSERT INTO projects(id,author_id) VALUES('p2','u1')").run();
db.prepare(
  "INSERT INTO project_versions(id,project_id,version_no,title,project_type,created_by) VALUES('r2','p2',1,'Other','角色','u1')",
).run();
for (const projectType of ["系统核心", "角色", "内容扩展", "玩法", "事件", "体验优化"]) {
  db.prepare("UPDATE project_versions SET project_type = ? WHERE id = 'r2'").run(projectType);
}
for (const value of ["NULL", "''", "'扩展'", "'未知'"]) {
  rejects(`UPDATE project_versions SET project_type=${value} WHERE id='r2'`, `invalid primary ${value} accepted`);
}
for (const value of [
  "NULL",
  "'not-json'",
  "'{}'",
  "'[null]'",
  "'[1]'",
  "'[\"未知\"]'",
  "'[\"系统核心\"]'",
  "'[\"体验优化\"]'",
  '\'["角色","角色"]\'',
]) {
  rejects(
    `UPDATE project_versions SET included_types=${value} WHERE id='r2'`,
    `invalid included types ${value} accepted`,
  );
}
db.prepare("UPDATE project_versions SET included_types = ? WHERE id = 'r2'").run('["角色","内容扩展","玩法","事件"]');
rejects(
  "UPDATE project_versions SET project_type='角色' WHERE id='r2'",
  "primary change accepted an existing self inclusion",
);
for (const tags of [
  "not-json",
  "{}",
  "[null]",
  "[1]",
  '[" "]',
  '["trim "]',
  '["a","a"]',
  JSON.stringify(["x".repeat(101)]),
  JSON.stringify(Array.from({ length: 21 }, (_, index) => `tag${index}`)),
]) {
  rejects(`UPDATE project_versions SET tags='${tags}' WHERE id='r2'`, `invalid tags ${tags} accepted`);
}
const twentyTags = Array.from({ length: 20 }, (_, index) => `tag${index}`);
db.prepare("UPDATE project_versions SET tags = ? WHERE id = 'r2'").run(JSON.stringify(twentyTags));
const indexedTags = db.prepare("SELECT tag FROM project_search_tags WHERE project_id='p1' ORDER BY tag").all();
if (JSON.stringify(indexedTags.map((row) => row.tag)) !== JSON.stringify(["cbz", "合集"])) {
  throw new Error(`structured taxonomy leaked into ordinary tags: ${JSON.stringify(indexedTags)}`);
}
const includedSearch = db
  .prepare("SELECT rowid FROM project_search_short WHERE project_search_short MATCH ?")
  .all("玩 法");
if (includedSearch.length !== 1) throw new Error("included categories were not indexed as searchable metadata");
for (const pointer of ["working_version_id", "published_version_id"]) {
  rejects(`UPDATE projects SET ${pointer}='r2' WHERE id='p1'`, `cross-project ${pointer} accepted`);
}
rejects("UPDATE projects SET published_cover_asset_id='a1' WHERE id='p2'", "cross-project cover accepted");
rejects("UPDATE submissions SET version_id='r2' WHERE id='s1'", "cross-project submission accepted");
rejects("UPDATE submissions SET base_published_version_id='r2' WHERE id='s1'", "cross-project baseline accepted");
rejects("DELETE FROM project_versions WHERE id='r1'", "referenced version was deleted");
rejects("DELETE FROM users WHERE id='u1'", "historical author was deleted");
rejects(
  "UPDATE automated_reviews SET report_hash='hash' WHERE submission_id='s1'",
  "ambiguous hash-only report accepted",
);
rejects(
  "UPDATE automated_reviews SET report_cleaned_at='2026-11-03' WHERE submission_id='s1'",
  "cleanup without fingerprint accepted",
);
db.prepare(
  "UPDATE automated_reviews SET report_hash='hash', checked_at=?, report_cleaned_at=? WHERE submission_id='s1'",
).run(now, now);
rejects(
  "UPDATE automated_reviews SET report_r2_key='report.json' WHERE submission_id='s1'",
  "cleaned report kept live object pointer",
);
db.prepare("DELETE FROM project_versions WHERE id='r2'").run();
db.prepare("DELETE FROM projects WHERE id='p2'").run();

let referencedProjectRejected = false;
try {
  db.prepare("DELETE FROM projects WHERE id = ?").run("p1");
} catch {
  referencedProjectRejected = true;
}
if (!referencedProjectRejected) throw new Error("referenced assets did not protect their project");
db.prepare(
  "UPDATE projects SET working_version_id=NULL,published_version_id=NULL,published_cover_asset_id=NULL WHERE id='p1'",
).run();
db.prepare("DELETE FROM assets WHERE project_id = ?").run("p1");
db.prepare("DELETE FROM automated_reviews WHERE submission_id = 's1'").run();
db.prepare("DELETE FROM submissions WHERE project_id='p1'").run();
db.prepare("DELETE FROM project_versions WHERE project_id='p1'").run();
db.prepare("DELETE FROM projects WHERE id = ?").run("p1");
for (const table of ["project_versions", "submissions", "project_search_tags"]) {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  if (count !== 0) throw new Error(`${table} retained orphan rows (${count})`);
}

console.log(
  `schema ok: ${expectedTables.length} tables, six-category taxonomy + ordinary tag integrity, FTS + short search, protected asset references`,
);
