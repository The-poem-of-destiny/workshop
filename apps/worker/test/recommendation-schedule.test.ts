import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readRecommendationBatch } from "../src/storage/recommendation-batches";
import { runRecommendationSchedule } from "../src/storage/recommendation-schedule";
import { deriveOpportunityWindows, FIXED_TRAFFIC_PROFILE } from "../src/traffic-profile";
import { applySchema } from "./support/schema";

const db = env.DB;
const hour = 3_600_000;
const day = 24 * hour;
const dayStart = Math.floor(Date.now() / day) * day + day;
const window = deriveOpportunityWindows(FIXED_TRAFFIC_PROFILE).find((item) => item.endHour - item.startHour >= 2)!;
const timestamp = dayStart + window.startHour * hour + 5 * 60_000;
const start = new Date(dayStart + window.startHour * hour).toISOString();
const end = new Date(dayStart + window.endHour * hour).toISOString();

beforeAll(async () => {
  await applySchema(db);
});
beforeEach(async () => {
  await db.exec(`DELETE FROM recommendation_batch_eligibility;
    DELETE FROM recommendation_batch_activations;
    DELETE FROM recommendation_batches;`);
  vi.useFakeTimers();
  vi.setSystemTime(timestamp);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("recommendation scheduling", () => {
  it("prebuilds the next window without a five-minute display gap", async () => {
    await runRecommendationSchedule(db, timestamp);
    const next = await db
      .prepare(`SELECT b.display_start_at,a.activated_at FROM recommendation_batches b
      JOIN recommendation_batch_activations a ON a.batch_id=b.id
      WHERE b.display_start_at>? ORDER BY b.display_start_at LIMIT 1`)
      .bind(new Date(timestamp).toISOString())
      .first<{ display_start_at: string; activated_at: string }>();
    expect(next).not.toBeNull();
    expect(next?.activated_at).toBe(next?.display_start_at);
    const boundary = Date.parse(next!.display_start_at);
    expect((await readRecommendationBatch(db, boundary - 1))?.displayEndAt).toBe(next?.display_start_at);
    expect((await readRecommendationBatch(db, boundary))?.displayStartAt).toBe(next?.display_start_at);
  });

  it("admits only one concurrent build per slot", async () => {
    await Promise.all([runRecommendationSchedule(db, timestamp), runRecommendationSchedule(db, timestamp)]);
    const rows = await db
      .prepare(`SELECT scheduled_at,COUNT(*) AS count FROM recommendation_batches
      GROUP BY scheduled_at`)
      .all<{ scheduled_at: string; count: number }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results.every((row) => row.count === 1)).toBe(true);
  });

  it("expires only an attempt whose own lease has aged an hour", async () => {
    await db
      .prepare(`INSERT INTO recommendation_batches(id,kind,status,scheduled_at,display_start_at,display_end_at,source_start_at,source_end_at,started_at)
      VALUES('active','discovery','building',?,?,?,?,?,?)`)
      .bind(start, start, end, start, end, new Date(timestamp).toISOString())
      .run();
    await runRecommendationSchedule(db, timestamp);
    expect(
      (await db.prepare("SELECT status FROM recommendation_batches WHERE id='active'").first<{ status: string }>())
        ?.status,
    ).toBe("building");
    vi.setSystemTime(timestamp + hour);
    await runRecommendationSchedule(db, timestamp + hour);
    const rows = await db
      .prepare("SELECT status FROM recommendation_batches WHERE scheduled_at=? ORDER BY rowid")
      .bind(start)
      .all<{ status: string }>();
    expect(rows.results.map((row) => row.status)).toEqual(["failed", "complete"]);
  });

  it("never retries a slot after three recorded failures", async () => {
    for (let index = 0; index < 3; index++) {
      await db
        .prepare(`INSERT INTO recommendation_batches(id,kind,status,scheduled_at,display_start_at,display_end_at,source_start_at,source_end_at)
        VALUES(?,'discovery','failed',?,?,?,?,?)`)
        .bind(`failure-${index}`, start, start, end, start, end)
        .run();
    }
    await runRecommendationSchedule(db, timestamp);
    const rows = await db
      .prepare("SELECT status FROM recommendation_batches WHERE scheduled_at=? ORDER BY id")
      .bind(start)
      .all<{ status: string }>();
    expect(rows.results.map((row) => row.status)).toEqual(["failed", "failed", "failed"]);
  });
});
