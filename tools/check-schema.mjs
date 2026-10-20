#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const schema = readFileSync("apps/worker/migrations/0001_initial.sql", "utf8");
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
db.exec(schema);

const expectedTables = [
  "users",
  "sessions",
  "oauth_flows",
  "projects",
  "project_revisions",
  "assets",
  "submissions",
  "reviews",
  "project_likes",
  "project_subscriptions",
  "project_ratings",
  "project_metrics_daily",
  "ranking_runs",
  "ranking_entries",
  "discovery_exposures",
  "recommendations",
  "site_settings",
  "reference_sets",
  "reference_versions",
  "reference_items",
  "audit_events",
  "project_search",
  "project_search_short",
  "project_search_tags",
];

const tables = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all().map(row => row.name),
);
for (const table of expectedTables) {
  if (!tables.has(table)) throw new Error(`missing table ${table}`);
}

const now = "2026-10-21T00:00:00.000Z";
db.prepare("INSERT INTO users (id, username, global_name, role, created_at, updated_at) VALUES (?, ?, ?, 'member', ?, ?)")
  .run("u1", "author", "作者", now, now);

db.prepare(`INSERT INTO projects
  (id, author_id, title, description, project_type, extension_type, visibility, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'public', ?, ?)`)
  .run("p1", "u1", "命定之诗测试项目", "描述", "系统核心", "规则", now, now);

db.prepare(`INSERT INTO project_revisions
  (id, project_id, revision_no, title, created_by, created_at)
  VALUES (?, ?, 1, ?, ?, ?)`)
  .run("r1", "p1", "命定之诗测试项目", "u1", now);

db.prepare(`INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
  VALUES (?, ?, ?, 'worldbook', ?, ?, 10, 'application/json', ?)`)
  .run("a1", "p1", "r1", "projects/p1/revisions/r1/worldbook.json", "0".repeat(64), now);

db.prepare(`INSERT INTO submissions (id, project_id, revision_id, submitted_by, submitted_at)
  VALUES (?, ?, ?, ?, ?)`)
  .run("s1", "p1", "r1", "u1", now);

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
  db.prepare(`INSERT INTO submissions (id, project_id, revision_id, submitted_by, submitted_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run("s2", "p1", "r1", "u1", now);
} catch {
  duplicatePendingRejected = true;
}
if (!duplicatePendingRejected) throw new Error("second pending submission was accepted");

db.prepare("DELETE FROM projects WHERE id = ?").run("p1");
for (const table of ["project_revisions", "assets", "submissions", "project_search_tags"]) {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  if (count !== 0) throw new Error(`${table} was not cascaded (${count} rows remain)`);
}

console.log(`schema ok: ${expectedTables.length} tables, FTS + short search, FK cascade`);
