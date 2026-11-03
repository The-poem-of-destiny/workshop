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

// An empty-schema check cannot detect history lost during a populated upgrade.
const upgrade = new DatabaseSync(":memory:");
for (const migration of migrations.filter((name) => name < "0031")) {
  upgrade.exec(readFileSync(`apps/worker/migrations/${migration}`, "utf8"));
}
upgrade.exec(`INSERT INTO users(id,username) VALUES('u','author');
  INSERT INTO projects(id,author_id,title) VALUES('p','u','title');
  INSERT INTO project_revisions(id,project_id,revision_no,title,created_by) VALUES('v','p',1,'title','u');
  INSERT INTO submissions(id,project_id,revision_id,submitted_by,check_status,client_gate,check_report,check_report_hash)
    VALUES('s','p','v','u','done','pass','{"routeGate":"pass"}','hash');
  INSERT INTO submission_check_runs(id,submission_id,review_checker_revision,route_gate,report,report_hash,duration_ms)
    VALUES('run','s','checker','pass','{"routeGate":"pass"}','hash',731);
  UPDATE projects SET published_revision_id='v',published_at='2024-01-01T00:00:00Z',updated_at='2026-01-01T00:00:00Z' WHERE id='p';
  UPDATE submissions SET status='approved',resolved_at='2024-02-01T00:00:00Z' WHERE id='s';
  CREATE TABLE review_report_transfer_receipts(source TEXT,source_id TEXT,submission_id TEXT,report_hash TEXT,
    PRIMARY KEY(source,source_id));
  INSERT INTO review_report_transfer_receipts VALUES('submissions','s','s','hash'),
    ('submission_check_runs','run','s','hash');`);
const originalAudit = '  {"before":{"reaction":"旧","comment":"原评语"}}\n';
upgrade
  .prepare("INSERT INTO audit_events(id,action,target_type,detail) VALUES('a','recommendation.update','project',?)")
  .run(originalAudit);
for (const migration of migrations.filter((name) => name >= "0031")) {
  upgrade.exec(readFileSync(`apps/worker/migrations/${migration}`, "utf8"));
}
const historicalAudit = upgrade.prepare("SELECT action,detail FROM audit_events WHERE id='a'").get();
if (
  historicalAudit.action !== "legacy.current_schema_event" ||
  JSON.parse(historicalAudit.detail).originalDetail !== originalAudit ||
  JSON.parse(historicalAudit.detail).originalAction !== "recommendation.update"
) {
  throw new Error("populated upgrade changed historical audit evidence");
}
if (upgrade.prepare("SELECT duration_ms FROM automated_reviews WHERE submission_id='s'").get().duration_ms !== 731) {
  throw new Error("populated upgrade lost retained review duration");
}
if (
  upgrade.prepare("SELECT published_updated_at FROM projects WHERE id='p'").get().published_updated_at !==
  "2024-02-01T00:00:00Z"
) {
  throw new Error("populated upgrade exposed draft time instead of approved publication time");
}
upgrade.close();

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
  "recommendation_runs",
  "recommendations",
  "site_settings",
  "audit_events",
  "project_search",
  "project_search_short",
  "project_search_tags",
  "automated_reviews",
  "recommendation_signals",
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
  (id, author_id, visibility, published_version_id, working_version_id, created_at, updated_at)
  VALUES (?, ?, 'public', 'r1', 'r1', ?, ?)`).run("p1", "u1", now, now);

db.prepare(`INSERT INTO project_versions
  (id, project_id, version_no, title, description, project_type, extension_type, created_by, created_at)
  VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`).run("r1", "p1", "命定之诗测试项目", "描述", "系统核心", "规则", "u1", now);

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

let referencedProjectRejected = false;
try {
  db.prepare("DELETE FROM projects WHERE id = ?").run("p1");
} catch {
  referencedProjectRejected = true;
}
if (!referencedProjectRejected) throw new Error("referenced assets did not protect their project");
db.prepare("DELETE FROM assets WHERE project_id = ?").run("p1");
db.prepare("DELETE FROM automated_reviews WHERE submission_id = 's1'").run();
db.prepare("DELETE FROM projects WHERE id = ?").run("p1");
for (const table of ["project_versions", "submissions", "project_search_tags"]) {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  if (count !== 0) throw new Error(`${table} retained orphan rows (${count})`);
}

console.log(`schema ok: ${expectedTables.length} tables, FTS + short search, protected asset references`);
