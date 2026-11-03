import { env } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import type { DataEnv } from "../src/data/env";
import { loadEstimatedOpportunities } from "../src/storage/recommendation-opportunities";
import { applySchema } from "./support/schema";

const db = (env as unknown as DataEnv).DB;
const hour = 3_600_000;
const base = Date.parse("2026-10-21T00:00:00.000Z");
const iso = (time: number) => new Date(time).toISOString();
const result = JSON.stringify({
  schemaVersion: 1,
  scoringVersion: "four-pool-v1",
  items: [
    {
      project_id: "p",
      project_version_id: "v",
      rank: 1,
      score: 1,
      pool: "new",
      contributions: {
        downloads: 0,
        likes: 0,
        trend: 0,
        freshness: 0,
        endorsements: 0,
        contentChange: 0,
        exposurePressure: null,
        categoryConfidence: 0,
        categoryScarcity: 0,
      },
      recommendations: [],
    },
  ],
});

beforeAll(() => applySchema(db));
beforeEach(async () => {
  await db.exec(
    "DELETE FROM recommendation_batch_eligibility; DELETE FROM recommendation_batch_activations; DELETE FROM recommendation_batches; UPDATE projects SET working_version_id=NULL,published_version_id=NULL,published_cover_asset_id=NULL; DELETE FROM project_versions; DELETE FROM projects; DELETE FROM users;",
  );
  await db.prepare("INSERT INTO users(id,username,role) VALUES('author','author','member')").run();
  await db
    .prepare("INSERT INTO projects(id,author_id,visibility,published_at) VALUES('p','author','public',?)")
    .bind(iso(base))
    .run();
  await db
    .prepare(
      "INSERT INTO project_versions(id,project_id,version_no,title,project_type,created_by,created_at) VALUES('v','p',1,'Project','角色','author',?)",
    )
    .bind(iso(base))
    .run();
  await db.prepare("UPDATE projects SET published_version_id='v' WHERE id='p'").run();
});

async function activate(id: string, at: number, evidence = true) {
  await db
    .prepare(`INSERT INTO recommendation_batches(id,kind,status,scheduled_at,display_start_at,display_end_at,source_start_at,source_end_at,result)
    VALUES(?,'discovery','complete',?,?,?,?,?,?)`)
    .bind(id, iso(at), iso(at), iso(at + 4 * hour), iso(at - hour), iso(at), result)
    .run();
  await db
    .prepare("INSERT INTO recommendation_batch_activations(batch_id,hourly_mean,activated_at) VALUES(?,?,?)")
    .bind(id, JSON.stringify(Array(24).fill(100)), iso(at))
    .run();
  if (evidence)
    await db
      .prepare("INSERT INTO recommendation_batch_eligibility(batch_id,project_id,project_version_id) VALUES(?,'p','v')")
      .bind(id)
      .run();
}

it("clips a prior activation at its replacement and integrates partial hours", async () => {
  await activate("first", base);
  await activate("second", base + 1.5 * hour);
  const totals = await loadEstimatedOpportunities(db, ["p"], { start: base + hour / 2, end: base + 2 * hour });
  expect(totals.get("p")).toBe(150);
});

it("uses activation insertion order to resolve simultaneous winners", async () => {
  await activate("z-first", base);
  await activate("a-last", base, false);
  const totals = await loadEstimatedOpportunities(db, ["p"], { start: base, end: base + hour });
  expect(totals.get("p")).toBeNull();
});

it("returns unknown rather than treating missing eligibility evidence as zero", async () => {
  await activate("first", base, false);
  const totals = await loadEstimatedOpportunities(db, ["p"], { start: base, end: base + hour });
  expect(totals.get("p")).toBeNull();
});

it("ends opportunity when a project is unpublished", async () => {
  const now = Date.now();
  await activate("first", now - hour);
  await db.prepare("UPDATE projects SET visibility='private' WHERE id='p'").run();
  const evidence = await db
    .prepare("SELECT ended_at FROM recommendation_batch_eligibility WHERE batch_id='first' AND project_id='p'")
    .first<{ ended_at: string }>();
  expect(evidence?.ended_at).toBeTruthy();
  const ended = Date.parse(evidence!.ended_at);
  const totals = await loadEstimatedOpportunities(db, ["p"], { start: now - hour, end: ended + hour });
  expect(totals.get("p")).toBeCloseTo((100 * (ended - (now - hour))) / hour);
});

it("ignores obsolete damaged history while retaining the active predecessor", async () => {
  await activate("obsolete", base - 20 * hour);
  await db
    .prepare("UPDATE recommendation_batches SET result=? WHERE id='obsolete'")
    .bind(JSON.stringify({ schemaVersion: 1, scoringVersion: "four-pool-v1", items: [{}] }))
    .run();
  await activate("predecessor", base - hour);
  const totals = await loadEstimatedOpportunities(db, ["p"], { start: base, end: base + hour });
  expect(totals.get("p")).toBe(100);
});

it("clips a predecessor when a replacement activates before its display begins", async () => {
  await activate("predecessor", base - hour);
  await activate("replacement", base + hour / 2);
  await db
    .prepare("UPDATE recommendation_batches SET display_start_at=? WHERE id='replacement'")
    .bind(iso(base + 2 * hour))
    .run();
  const totals = await loadEstimatedOpportunities(db, ["p"], { start: base, end: base + hour });
  expect(totals.get("p")).toBe(50);
});

it("ignores a future activation but keeps unknown overlapping eligibility", async () => {
  await activate("current", base - hour, false);
  await activate("future", base + 2 * hour);
  const totals = await loadEstimatedOpportunities(db, ["p"], { start: base, end: base + hour });
  expect(totals.get("p")).toBeNull();
});

it("uses each activation's historical profile after the configured profile changes", async () => {
  await activate("old", base);
  await activate("new", base + hour);
  await db
    .prepare("UPDATE recommendation_batch_activations SET hourly_mean=? WHERE batch_id='new'")
    .bind(JSON.stringify(Array(24).fill(200)))
    .run();
  const totals = await loadEstimatedOpportunities(db, ["p"], { start: base, end: base + 2 * hour });
  expect(totals.get("p")).toBe(300);
});
