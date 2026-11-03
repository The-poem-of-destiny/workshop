import { deriveOpportunityWindows, FIXED_TRAFFIC_PROFILE } from "../traffic-profile.js";
import { buildRecommendationBatch } from "./recommendation-batches";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_ATTEMPTS = 3;

export async function runRecommendationSchedule(
  db: D1Database,
  timestamp: number,
  configuration?: string,
): Promise<void> {
  if (!Number.isFinite(timestamp)) throw new Error("Invalid recommendation schedule time");
  const windows = deriveOpportunityWindows(FIXED_TRAFFIC_PROFILE);
  const dayStart = Math.floor(timestamp / DAY) * DAY;
  const hour = (timestamp - dayStart) / HOUR;
  const window = windows.find((item) => item.startHour <= hour && hour < item.endHour);
  if (!window) throw new Error("Recommendation traffic profile has no current window");
  const slots = [
    { start: dayStart + window.startHour * HOUR, end: dayStart + window.endHour * HOUR },
    (() => {
      const nextStart = dayStart + window.endHour * HOUR;
      const nextWindow = windows.find((item) => item.startHour === window.endHour % 24);
      if (!nextWindow) throw new Error("Recommendation traffic profile has no next window");
      return { start: nextStart, end: nextStart + (nextWindow.endHour - nextWindow.startHour) * HOUR };
    })(),
  ];
  for (const slot of slots) {
    const scheduledAt = new Date(slot.start).toISOString();
    // A slot's scheduled time is not a safe lease: retries can begin long after it.
    await db
      .prepare(`UPDATE recommendation_batches SET status='failed',error='Interrupted batch build'
      WHERE kind='discovery' AND scheduled_at=? AND status='building' AND started_at IS NOT NULL AND started_at<=?`)
      .bind(scheduledAt, new Date(Date.now() - HOUR).toISOString())
      .run();
    const attempts = await db
      .prepare(`SELECT COUNT(*) AS count, MAX(CASE WHEN status='complete' THEN 1 ELSE 0 END) AS complete
      FROM recommendation_batches WHERE kind='discovery' AND scheduled_at=?`)
      .bind(scheduledAt)
      .first<{ count: number; complete: number | null }>();
    if ((attempts?.count ?? 0) >= MAX_ATTEMPTS || attempts?.complete) continue;
    await buildRecommendationBatch(db, timestamp, configuration, slot);
  }
}
