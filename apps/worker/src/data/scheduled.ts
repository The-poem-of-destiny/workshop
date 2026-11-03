import { observeCleanupCandidates } from "../storage/recommendation-batches.js";
import { runRecommendationSchedule } from "../storage/recommendation-schedule";

const MAX_ATTEMPTS = 3;

export async function buildScheduledRecommendationBatch(
  db: D1Database,
  scheduledTime: number,
  configuration?: string,
): Promise<void> {
  await runRecommendationSchedule(db, scheduledTime, configuration);
}

export async function cleanupScheduledData(db: D1Database, scheduledTime: number) {
  return observeCleanupCandidates(db, scheduledTime);
}

export async function findDueSubmissions(db: D1Database, scheduledTime: number): Promise<string[]> {
  const now = new Date(scheduledTime).toISOString();
  await db.batch([
    db
      .prepare(`UPDATE automated_reviews SET status = 'needs_human', lease_until = NULL, lease_token = NULL,
      error = COALESCE(error, '检查超时次数已达上限，转人工审核。')
      WHERE status IN ('queued','running') AND attempts >= ? AND (lease_until IS NULL OR lease_until < ?)
        AND EXISTS(SELECT 1 FROM submissions s WHERE s.id = submission_id AND s.status IN ('checking','pending'))`)
      .bind(MAX_ATTEMPTS, now),
    db.prepare(`UPDATE submissions SET status = 'pending' WHERE status = 'checking'
      AND EXISTS(SELECT 1 FROM automated_reviews a WHERE a.submission_id = submissions.id AND a.status = 'needs_human')`),
  ]);

  const due = await db
    .prepare(`
    SELECT s.id FROM submissions s JOIN automated_reviews a ON a.submission_id = s.id
    WHERE s.status IN ('checking', 'pending')
      AND a.status IN ('queued', 'running')
      AND a.attempts < ?
      AND (a.lease_until IS NULL OR a.lease_until < ?)
    ORDER BY s.submitted_at ASC
    LIMIT 20
  `)
    .bind(MAX_ATTEMPTS, now)
    .all<{ id: string }>();
  return due.results.map((row) => row.id);
}
