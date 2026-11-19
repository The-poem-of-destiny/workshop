import { findDueContentSubmissions } from "../storage/content-reviews.js";
import { observeCleanupCandidates } from "../storage/recommendation-batches.js";
import { runRecommendationSchedule } from "../storage/recommendation-schedule";
import { FIXED_TRAFFIC_PROFILE } from "../traffic-profile.js";

export async function buildScheduledRecommendationBatch(
  db: D1Database,
  scheduledTime: number,
  configuration?: string,
): Promise<void> {
  await runRecommendationSchedule(db, scheduledTime, FIXED_TRAFFIC_PROFILE, configuration);
}

export async function cleanupScheduledData(db: D1Database, scheduledTime: number) {
  return observeCleanupCandidates(db, scheduledTime);
}

export async function findDueSubmissions(db: D1Database, scheduledTime: number): Promise<string[]> {
  return findDueContentSubmissions(db, scheduledTime);
}
