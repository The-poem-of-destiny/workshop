import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DataEnv } from "../src/data/env";
import { buildRankings, observeCleanupCandidates, readRecommendationRun } from "../src/storage/rankings";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const now = "2026-10-21T00:00:00.000Z";

async function seedProject(id: string, downloads: number) {
  await bindings.DB.prepare(
    "INSERT INTO users (id, username, role, created_at, updated_at) VALUES (?, ?, 'member', ?, ?)",
  )
    .bind(`u-${id}`, `u-${id}`, now, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO projects (id, author_id, visibility, working_version_id, published_version_id,
      published_at, created_at, updated_at)
    VALUES (?, ?, 'public', ?, ?, ?, ?, ?)
  `)
    .bind(id, `u-${id}`, `r-${id}`, `r-${id}`, now, now, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO project_versions (id, project_id, version_no, title, created_by, created_at)
    VALUES (?, ?, 1, ?, ?, ?)
  `)
    .bind(`r-${id}`, id, id, `u-${id}`, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO project_metrics_daily (day_key, project_id, downloads) VALUES (?, ?, ?)
  `)
    .bind(now.slice(0, 10), id, downloads)
    .run();
}

beforeAll(async () => {
  await applySchema(bindings.DB);
});

beforeEach(async () => {
  await bindings.DB.exec(`
    DELETE FROM recommendation_runs;
    DELETE FROM project_metrics_daily;
    DELETE FROM download_daily_stats;
    DELETE FROM projects;
    DELETE FROM users;
    DELETE FROM sessions;
    DELETE FROM oauth_flows;
  `);
});

describe("scheduled jobs", () => {
  it("serves only current versions within the successful run display interval", async () => {
    await seedProject("p1", 10);
    await seedProject("p2", 3);
    await buildRankings(bindings.DB, new Date(now));
    const run = await readRecommendationRun(bindings.DB, "discovery", Date.parse(now));
    expect(run?.items.map((item) => item.project_id).sort()).toEqual(["p1", "p2"]);
    expect(run?.items.map((item) => item.project_version_id).sort()).toEqual(["r-p1", "r-p2"]);
    await bindings.DB.prepare("UPDATE projects SET visibility='private' WHERE id='p1'").run();
    expect(
      (await readRecommendationRun(bindings.DB, "discovery", Date.parse(now)))?.items.map((item) => item.project_id),
    ).toEqual(["p2"]);
    expect(await readRecommendationRun(bindings.DB, "discovery", Date.parse(now) + 3_600_000)).toBeNull();
    await bindings.DB.prepare(`INSERT INTO recommendation_runs(id,kind,status,scheduled_at,display_start_at,display_end_at,source_start_at,source_end_at,error)
      VALUES('failed','discovery','failed',?,?,?,?,?,'failure')`)
      .bind(now, now, "2026-10-21T01:00:00.000Z", now, "2026-10-22T00:00:00.000Z")
      .run();
    expect(
      (await readRecommendationRun(bindings.DB, "discovery", Date.parse(now)))?.items.map((item) => item.project_id),
    ).toEqual(["p2"]);
  });

  it("reports old and recent deletion candidates without imposing retention or deleting rows", async () => {
    await seedProject("old", 0);
    await seedProject("recent", 0);
    await bindings.DB.prepare("UPDATE projects SET deleted_at = ? WHERE id = ?")
      .bind("2020-01-01T00:00:00.000Z", "old")
      .run();
    await bindings.DB.prepare("UPDATE projects SET deleted_at = ? WHERE id = ?")
      .bind("2026-10-20T00:00:00.000Z", "recent")
      .run();
    await bindings.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('expired', 'u-old', '2000-01-01T00:00:00.000Z')",
    ).run();
    await bindings.DB.prepare(`INSERT INTO oauth_flows (id, state_hash, origin, mode, expires_at)
      VALUES ('expired', 'expired', 'https://workshop.test', 'browser', '2000-01-01T00:00:00.000Z')`).run();
    const result = await observeCleanupCandidates(bindings.DB, Date.parse(now));
    expect(result).toMatchObject({
      retentionPolicy: "undecided",
      softDeletedProjects: 2,
      expiredSessions: 1,
      completedFlows: 1,
      orphanAssetRows: 0,
    });
    const projects = await bindings.DB.prepare("SELECT id FROM projects ORDER BY id").all<{ id: string }>();
    expect(projects.results).toEqual([{ id: "old" }, { id: "recent" }]);
    const session = await bindings.DB.prepare("SELECT token_hash FROM sessions").all();
    const flow = await bindings.DB.prepare("SELECT id FROM oauth_flows").all();
    expect(session.results).toEqual([{ token_hash: "expired" }]);
    expect(flow.results).toEqual([{ id: "expired" }]);
  });
});
