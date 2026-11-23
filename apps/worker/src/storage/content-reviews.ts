import type { ProjectEntryKind } from "@workshop/domain";
import type { RunTarget } from "../data/contracts.js";

interface ContentAsset {
  kind: ProjectEntryKind;
  r2_key: string;
}

interface SubmissionMetadataRow {
  title: string;
  description: string | null;
  requirements: string | null;
  version_label: string | null;
  tags: string;
  cover_position_x: number;
  cover_position_y: number;
  cover_zoom: number;
}

const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export async function getContentReviewTarget(db: D1Database, submissionId: string): Promise<RunTarget | null> {
  return db
    .prepare(`SELECT s.id, s.project_id, s.version_id, s.base_published_version_id, s.status,
    a.status AS check_status, a.attempts AS check_attempts, a.lease_token, a.lease_until, a.client_gate, a.checker_version AS checker_version
    FROM submissions s JOIN automated_reviews a ON a.submission_id = s.id WHERE s.id = ?`)
    .bind(submissionId)
    .first<RunTarget>();
}

export async function claimContentReview(db: D1Database, submissionId: string): Promise<string | null> {
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  const token = crypto.randomUUID();
  const claimed = await db
    .prepare(`UPDATE automated_reviews
    SET status = 'running', lease_until = ?, lease_token = ?, attempts = attempts + 1, error = NULL
    WHERE submission_id = ? AND status IN ('queued','running')
      AND (status = 'queued' OR lease_until IS NULL OR lease_until < ?) AND attempts < ?
      AND EXISTS(SELECT 1 FROM submissions s WHERE s.id = submission_id AND s.status IN ('checking','pending'))`)
    .bind(leaseUntil, token, submissionId, now, MAX_ATTEMPTS)
    .run();
  return claimed.meta.changes !== 0 ? token : null;
}

async function readContentFiles(r2: R2Bucket, assets: ContentAsset[]) {
  const files: { kind: ProjectEntryKind; text: string | null }[] = [];
  for (const asset of assets) {
    const object = await r2.get(asset.r2_key);
    files.push({ kind: asset.kind, text: object ? await object.text() : null });
    if (!object) break;
  }
  return files;
}

export async function loadSubmissionContent(db: D1Database, r2: R2Bucket, versionId: string) {
  const assets = await db
    .prepare(`SELECT kind, r2_key FROM assets WHERE version_id = ?
    AND kind IN ('worldbook', 'regex') ORDER BY kind`)
    .bind(versionId)
    .all<ContentAsset>();
  const files = await readContentFiles(r2, assets.results);
  const metadata = await db
    .prepare(`SELECT title, description, requirements, version_label, tags,
    cover_position_x, cover_position_y, cover_zoom FROM project_versions WHERE id = ?`)
    .bind(versionId)
    .first<SubmissionMetadataRow>();
  return { files, metadata };
}

export async function loadVersionContent(db: D1Database, r2: R2Bucket, versionId: string, projectId: string) {
  const assets = await db
    .prepare(`SELECT kind, r2_key FROM assets WHERE version_id = ? AND project_id = ?
    AND kind IN ('worldbook', 'regex')`)
    .bind(versionId, projectId)
    .all<ContentAsset>();
  return readContentFiles(r2, assets.results);
}

export async function recordContentReviewRun(
  db: D1Database,
  r2: R2Bucket,
  submissionId: string,
  leaseToken: string,
  checkerVersion: string,
  route: "block" | "warn" | "pass",
  report: string,
  hash: string,
  durationMs: number,
  checkedAt: string,
): Promise<boolean> {
  const key = `reports/${submissionId}/${hash}.json`;
  await r2.put(key, report, { httpMetadata: { contentType: "application/json" } });
  const result = await db
    .prepare(`UPDATE automated_reviews SET checker_version = ?, route_gate = ?, report_r2_key = ?,
    report_hash = ?, report_cleaned_at = NULL, duration_ms = ?, checked_at = ? WHERE submission_id = ? AND status = 'running' AND lease_token = ?
    AND EXISTS(SELECT 1 FROM submissions s WHERE s.id = submission_id AND s.status IN ('checking','pending'))`)
    .bind(checkerVersion, route, key, hash, durationMs, checkedAt, submissionId, leaseToken)
    .run();
  return result.meta.changes !== 0;
}

export async function markContentReviewNeedsHuman(
  db: D1Database,
  submissionId: string,
  message: string,
  leaseToken: string | null,
): Promise<void> {
  await db.batch([
    db
      .prepare(`UPDATE automated_reviews SET status = 'needs_human', lease_until = NULL, error = ?
      WHERE submission_id = ? AND lease_token IS ? AND EXISTS(SELECT 1 FROM submissions s WHERE s.id = submission_id AND s.status IN ('checking','pending'))`)
      .bind(message, submissionId, leaseToken),
    db
      .prepare(`UPDATE submissions SET status = 'pending' WHERE id = ? AND status IN ('checking','pending')
      AND EXISTS(SELECT 1 FROM automated_reviews a WHERE a.submission_id = submissions.id AND a.status = 'needs_human' AND a.lease_token IS ?)`)
      .bind(submissionId, leaseToken),
  ]);
}

export async function requeueContentReview(
  db: D1Database,
  submissionId: string,
  message: string,
  leaseToken: string,
): Promise<void> {
  await db
    .prepare(`UPDATE automated_reviews SET status = 'queued', lease_until = NULL, error = ?
    WHERE submission_id = ? AND status = 'running' AND lease_token = ?
      AND EXISTS(SELECT 1 FROM submissions s WHERE s.id = submission_id AND s.status IN ('checking','pending'))`)
    .bind(message, submissionId, leaseToken)
    .run();
}

export async function autoPublishContentReview(db: D1Database, target: RunTarget, leaseToken: string) {
  const now = new Date().toISOString();
  const results = await db.batch([
    // Publish before resolving the submission. All later writes are
    // conditional on this successful pointer transition.
    db
      .prepare(`
      UPDATE projects
      SET published_version_id = ?, published_at = ?, published_updated_at = ?, published_cover_asset_id = NULL,
          row_version = row_version + 1, updated_at = ?
      FROM submissions s
      JOIN project_versions r ON r.id = s.version_id
      WHERE projects.id = s.project_id
        AND s.id = ? AND s.status = 'checking'
        AND EXISTS(SELECT 1 FROM automated_reviews a WHERE a.submission_id = s.id AND a.status = 'running' AND a.lease_token = ?)
        AND s.version_id = ?
        AND projects.deleted_at IS NULL
        AND projects.published_version_id IS s.base_published_version_id
        AND projects.published_version_id IS NOT s.version_id
    `)
      .bind(target.version_id, now, now, now, target.id, leaseToken, target.version_id),
    db
      .prepare(`
      UPDATE submissions
      SET status = 'approved', resolved_at = ?, auto_published_at = ?
      WHERE id = ? AND status = 'checking'
        AND EXISTS (SELECT 1 FROM automated_reviews a WHERE a.submission_id = submissions.id AND a.status = 'running' AND a.lease_token = ?)
        AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL AND published_version_id = ?)
    `)
      .bind(now, now, target.id, leaseToken, target.project_id, target.version_id),
    db
      .prepare(`UPDATE automated_reviews SET status = 'done',lease_until = NULL,error = NULL
      WHERE submission_id = ? AND lease_token = ? AND EXISTS(SELECT 1 FROM submissions s WHERE s.id = submission_id AND s.status = 'approved')`)
      .bind(target.id, leaseToken),
  ]);
  if ((results[1]?.meta.changes ?? 0) !== 0) return true;

  // A competing publication or deletion invalidated the captured baseline.
  // Keep that outcome as history instead of retrying a stale publication.
  await db.batch([
    db
      .prepare(`
        UPDATE submissions
        SET status = 'superseded', resolved_at = ?
        WHERE id = ? AND status = 'checking'
          AND EXISTS(SELECT 1 FROM automated_reviews a WHERE a.submission_id = submissions.id AND a.status = 'running' AND a.lease_token = ?)
          AND (
            NOT EXISTS (SELECT 1 FROM projects WHERE id = ?)
            OR EXISTS (
              SELECT 1 FROM projects
              WHERE id = ? AND (
                deleted_at IS NOT NULL OR published_version_id IS NOT ?
              )
            )
          )
      `)
      .bind(now, target.id, leaseToken, target.project_id, target.project_id, target.base_published_version_id),
    db
      .prepare(`
        UPDATE automated_reviews
        SET status = 'done', lease_until = NULL, error = NULL
        WHERE submission_id = ? AND lease_token = ?
          AND EXISTS (SELECT 1 FROM submissions s WHERE s.id = submission_id AND s.status = 'superseded')
      `)
      .bind(target.id, leaseToken),
  ]);
  return false;
}

export async function findDueContentSubmissions(db: D1Database, scheduledTime: number): Promise<string[]> {
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
