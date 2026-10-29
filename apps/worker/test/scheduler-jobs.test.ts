import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DataEnv } from "../src/data/env";
import { buildRankings, cleanupExpired } from "../src/storage/rankings";
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
    INSERT INTO projects (id, author_id, title, visibility, working_revision_id, published_revision_id,
      published_at, created_at, updated_at)
    VALUES (?, ?, ?, 'public', ?, ?, ?, ?, ?)
  `)
    .bind(id, `u-${id}`, id, `r-${id}`, `r-${id}`, now, now, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO project_revisions (id, project_id, revision_no, title, created_by, created_at)
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
    DELETE FROM discovery_exposures;
    DELETE FROM ranking_entries;
    DELETE FROM ranking_runs;
    DELETE FROM project_metrics_daily;
    DELETE FROM projects;
    DELETE FROM users;
    DELETE FROM sessions;
    DELETE FROM download_tokens;
    DELETE FROM oauth_flows;
  `);
});

describe("scheduled jobs", () => {
  it("builds daily, 7d and 30d rankings and discovery exposure", async () => {
    await seedProject("p1", 10);
    await seedProject("p2", 3);
    await buildRankings(bindings.DB, new Date(now));

    const runs = await bindings.DB.prepare("SELECT kind, status FROM ranking_runs ORDER BY kind").all<{
      kind: string;
      status: string;
    }>();
    expect(runs.results).toEqual([
      { kind: "30d", status: "complete" },
      { kind: "7d", status: "complete" },
      { kind: "daily", status: "complete" },
    ]);
    const daily = await bindings.DB.prepare(`
      SELECT e.rank, e.project_id, e.score FROM ranking_entries e
      JOIN ranking_runs r ON r.id = e.run_id
      WHERE r.kind = 'daily' ORDER BY e.rank
    `).all<{ rank: number; project_id: string; score: number }>();
    expect(daily.results).toEqual([
      { rank: 1, project_id: "p1", score: 10 },
      { rank: 2, project_id: "p2", score: 3 },
    ]);
    const exposures = await bindings.DB.prepare("SELECT project_id, rank FROM discovery_exposures ORDER BY rank").all<{
      project_id: string;
      rank: number;
    }>();
    expect(exposures.results).toEqual([
      { project_id: "p1", rank: 1 },
      { project_id: "p2", rank: 2 },
    ]);
  });

  it("keeps soft-deleted projects for 90 days and supports a dry run", async () => {
    await seedProject("old", 0);
    await seedProject("recent", 0);
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    await bindings.DB.prepare("UPDATE projects SET deleted_at = ? WHERE id = 'old'").bind(daysAgo(100)).run();
    await bindings.DB.prepare("UPDATE projects SET deleted_at = ? WHERE id = 'recent'").bind(daysAgo(60)).run();
    const preview = await cleanupExpired(bindings.DB, true);
    expect(preview.deletedProjects).toBe(1);
    const before = await bindings.DB.prepare("SELECT COUNT(*) AS n FROM projects").first<{ n: number }>();
    expect(before?.n).toBe(2);
    await cleanupExpired(bindings.DB);
    const remaining = await bindings.DB.prepare("SELECT id FROM projects ORDER BY id").all<{ id: string }>();
    expect(remaining.results).toEqual([{ id: "recent" }]);
  });

  it("removes expired sessions, flows and download tokens", async () => {
    await bindings.DB.prepare("INSERT INTO users (id, username) VALUES ('u1', 'u1')").run();
    await bindings.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('s', 'u1', '2000-01-01T00:00:00.000Z')",
    ).run();
    await bindings.DB.prepare(`
      INSERT INTO oauth_flows (id, state_hash, origin, mode, expires_at)
      VALUES ('f', 'h', 'https://workshop.test', 'browser', '2000-01-01T00:00:00.000Z')
    `).run();
    await bindings.DB.prepare(`
      INSERT INTO download_tokens (token_hash, user_id, project_id, revision_id, kind, expires_at)
      VALUES ('d', 'u1', 'p', 'r', 'worldbook', '2000-01-01T00:00:00.000Z')
    `)
      .run()
      .catch(() => undefined);
    await cleanupExpired(bindings.DB);
    const counts = await Promise.all([
      bindings.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>(),
      bindings.DB.prepare("SELECT COUNT(*) AS n FROM oauth_flows").first<{ n: number }>(),
    ]);
    expect(counts[0]?.n).toBe(0);
    expect(counts[1]?.n).toBe(0);
  });
});
