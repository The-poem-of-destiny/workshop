import { buildRankings, cleanupExpired } from "../storage/rankings.js";

const MAX_ATTEMPTS = 3;

export async function buildScheduledRankings(db: D1Database, scheduledTime: number): Promise<void> {
  await buildRankings(db, new Date(scheduledTime));
}

export async function cleanupScheduledData(db: D1Database, dryRun: boolean, scheduledTime: number) {
  return cleanupExpired(db, dryRun, new Date(scheduledTime));
}

export async function findDueSubmissions(db: D1Database, scheduledTime: number): Promise<string[]> {
  const now = new Date(scheduledTime).toISOString();
  await db
    .prepare(`
    UPDATE submissions
    SET status = 'pending', check_status = 'needs_human', check_lease_until = NULL,
        check_error = COALESCE(check_error, '检查超时次数已达上限，转人工审核。')
    WHERE status IN ('checking', 'pending') AND check_status IN ('queued', 'running') AND check_attempts >= ?
      AND (check_lease_until IS NULL OR check_lease_until < ?)
  `)
    .bind(MAX_ATTEMPTS, now)
    .run();

  const due = await db
    .prepare(`
    SELECT id FROM submissions
    WHERE status IN ('checking', 'pending')
      AND check_status IN ('queued', 'running')
      AND check_attempts < ?
      AND (check_lease_until IS NULL OR check_lease_until < ?)
    ORDER BY submitted_at ASC
    LIMIT 20
  `)
    .bind(MAX_ATTEMPTS, now)
    .all<{ id: string }>();
  return due.results.map((row) => row.id);
}
