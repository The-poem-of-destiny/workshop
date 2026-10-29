import type { ProjectEntryKind } from "@workshop/domain";
import { REVIEW_CHECKER_REVISION } from "../content-checker";

export interface ContentEnv {
  DB: D1Database;
  R2: R2Bucket;
}
export interface RunTarget {
  id: string;
  project_id: string;
  revision_id: string;
  base_published_revision_id: string | null;
  status: string;
  check_status: string;
  check_attempts: number;
  client_gate: string | null;
  review_checker_revision: string | null;
}
interface ContentAsset {
  kind: ProjectEntryKind;
  r2_key: string;
}
interface Metadata {
  title: string;
  description: string | null;
  author_note: string | null;
  precautions: string | null;
  version_label: string | null;
  tags: string;
  cover_position_x: number;
  cover_position_y: number;
  cover_zoom: number;
}
const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export async function contentGetTarget(env: ContentEnv, submissionId: string): Promise<RunTarget | null> {
  return env.DB.prepare(`SELECT id, project_id, revision_id, base_published_revision_id, status, check_status,
    check_attempts, client_gate, review_checker_revision FROM submissions WHERE id = ?`)
    .bind(submissionId)
    .first<RunTarget>();
}
export async function contentClaim(env: ContentEnv, submissionId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  const claimed = await env.DB.prepare(`UPDATE submissions
    SET check_status = 'running', check_lease_until = ?, check_attempts = check_attempts + 1, check_error = NULL
    WHERE id = ? AND status IN ('checking', 'pending') AND check_status IN ('queued', 'running')
      AND (check_status = 'queued' OR check_lease_until IS NULL OR check_lease_until < ?) AND check_attempts < ?`)
    .bind(leaseUntil, submissionId, now, MAX_ATTEMPTS)
    .run();
  return claimed.meta.changes !== 0;
}
async function readFiles(env: ContentEnv, assets: ContentAsset[]) {
  const files: { kind: ProjectEntryKind; text: string | null }[] = [];
  for (const asset of assets) {
    const object = await env.R2.get(asset.r2_key);
    files.push({ kind: asset.kind, text: object ? await object.text() : null });
    if (!object) break;
  }
  return files;
}
export async function contentLoadSubmission(env: ContentEnv, revisionId: string) {
  const assets = await env.DB.prepare(`SELECT kind, r2_key FROM assets WHERE revision_id = ?
    AND kind IN ('worldbook', 'regex') ORDER BY kind`)
    .bind(revisionId)
    .all<ContentAsset>();
  const files = await readFiles(env, assets.results);
  const metadata = await env.DB.prepare(`SELECT title, description, author_note, precautions, version_label, tags,
    cover_position_x, cover_position_y, cover_zoom FROM project_revisions WHERE id = ?`)
    .bind(revisionId)
    .first<Metadata>();
  return { files, metadata };
}
export async function contentRecordRun(
  env: ContentEnv,
  submissionId: string,
  route: "block" | "warn" | "pass",
  report: string,
  hash: string,
  durationMs: number,
  checkedAt: string,
): Promise<void> {
  await env.DB.prepare(`INSERT INTO submission_check_runs
    (id, submission_id, review_checker_revision, route_gate, report, report_hash, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), submissionId, REVIEW_CHECKER_REVISION, route, report, hash, durationMs, checkedAt)
    .run();
}
export async function contentNeedsHuman(
  env: ContentEnv,
  submissionId: string,
  message: string,
  result: { report: string; hash: string; checkedAt: string } | null,
): Promise<void> {
  await env.DB.prepare(`UPDATE submissions SET status = 'pending', check_status = 'needs_human', check_lease_until = NULL,
    check_error = ?, check_report = COALESCE(?, check_report), check_report_hash = COALESCE(?, check_report_hash),
    checked_at = COALESCE(?, checked_at), review_checker_revision = COALESCE(?, review_checker_revision)
    WHERE id = ? AND status IN ('checking', 'pending')`)
    .bind(
      message,
      result?.report ?? null,
      result?.hash ?? null,
      result?.checkedAt ?? null,
      result ? REVIEW_CHECKER_REVISION : null,
      submissionId,
    )
    .run();
}
export async function contentRequeue(env: ContentEnv, submissionId: string, message: string): Promise<void> {
  await env.DB.prepare(`UPDATE submissions SET check_status = 'queued', check_lease_until = NULL, check_error = ?
    WHERE id = ? AND status IN ('checking', 'pending') AND check_status = 'running'`)
    .bind(message, submissionId)
    .run();
}
export async function contentLoadRevision(env: ContentEnv, revisionId: string, projectId: string) {
  const assets = await env.DB.prepare(`SELECT kind, r2_key FROM assets WHERE revision_id = ? AND project_id = ?
    AND kind IN ('worldbook', 'regex')`)
    .bind(revisionId, projectId)
    .all<ContentAsset>();
  return readFiles(env, assets.results);
}
export async function contentBaselineConflict(env: ContentEnv, fingerprints: string[]): Promise<string | null> {
  if (!fingerprints.length) return null;
  const match = await env.DB.prepare(`SELECT display_name FROM reference_items WHERE kind = 'worldbook'
    AND exact_hash IN (${fingerprints.map(() => "?").join(", ")}) LIMIT 1`)
    .bind(...fingerprints)
    .first<{ display_name: string }>();
  return match?.display_name ?? null;
}

export async function contentAutoPublish(
  env: ContentEnv,
  target: RunTarget,
  report: string,
  reportHash: string,
  checkedAt: string,
) {
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    // Publish before resolving the submission. All later writes are
    // conditional on this successful pointer transition.
    env.DB.prepare(`
      UPDATE projects
      SET published_revision_id = ?, published_at = ?, published_cover_asset_id = NULL,
          title = r.title, description = r.description, author_note = r.author_note,
          project_type = r.project_type, extension_type = r.extension_type,
          search_tags = r.tags, published_schema_version = r.schema_version,
          published_discord_thread_url = r.discord_thread_url,
          version_label = r.version_label, precautions = r.precautions,
          cover_position_x = r.cover_position_x, cover_position_y = r.cover_position_y,
          cover_zoom = r.cover_zoom, metadata_findings = r.metadata_findings,
          metadata_checker_revision = r.metadata_checker_revision,
          metadata_checked_at = r.metadata_checked_at, metadata_checked_by = r.metadata_checked_by,
          row_version = row_version + 1, updated_at = ?
      FROM submissions s
      JOIN project_revisions r ON r.id = s.revision_id
      WHERE projects.id = s.project_id
        AND s.id = ? AND s.status = 'checking' AND s.check_status = 'running'
        AND s.revision_id = ?
        AND projects.deleted_at IS NULL
        AND projects.published_revision_id IS s.base_published_revision_id
        AND projects.published_revision_id IS NOT s.revision_id
    `).bind(target.revision_id, now, now, target.id, target.revision_id),
    env.DB.prepare(`
      UPDATE submissions
      SET status = 'approved', check_status = 'done', check_lease_until = NULL,
          resolved_at = ?, checked_at = ?, check_report = ?, check_report_hash = ?,
          review_checker_revision = ?, auto_published_at = ?, check_error = NULL
      WHERE id = ? AND status = 'checking' AND check_status = 'running'
        AND EXISTS (
          SELECT 1 FROM projects
          WHERE id = ? AND deleted_at IS NULL AND published_revision_id = ?
        )
    `).bind(
      now,
      checkedAt,
      report,
      reportHash,
      REVIEW_CHECKER_REVISION,
      now,
      target.id,
      target.project_id,
      target.revision_id,
    ),
    env.DB.prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      SELECT ?, 'review.auto_publish', 'submission', ?, NULL, ?, ?
      WHERE EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = 'approved')
    `).bind(
      crypto.randomUUID(),
      target.id,
      JSON.stringify({
        projectId: target.project_id,
        revisionId: target.revision_id,
        reviewCheckerRevision: REVIEW_CHECKER_REVISION,
        reportHash,
      }),
      now,
      target.id,
    ),
  ]);
  if ((results[1]?.meta.changes ?? 0) !== 0) return true;

  // A competing publication or deletion invalidated the captured baseline.
  // Keep that outcome as history instead of retrying a stale publication.
  await env.DB.batch([
    env.DB.prepare(`
        UPDATE submissions
        SET status = 'superseded', resolved_at = ?, check_lease_until = NULL,
            check_error = '发布基线已变化，请创建新修订后重新提交'
        WHERE id = ? AND status = 'checking' AND check_status = 'running'
          AND (
            NOT EXISTS (SELECT 1 FROM projects WHERE id = ?)
            OR EXISTS (
              SELECT 1 FROM projects
              WHERE id = ? AND (
                deleted_at IS NOT NULL OR published_revision_id IS NOT ?
              )
            )
          )
      `).bind(now, target.id, target.project_id, target.project_id, target.base_published_revision_id),
    env.DB.prepare(`
        INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        SELECT ?, 'review.auto_publish_conflict', 'submission', ?, NULL, ?, ?
        WHERE changes() = 1
      `).bind(
      crypto.randomUUID(),
      target.id,
      JSON.stringify({
        projectId: target.project_id,
        revisionId: target.revision_id,
        basePublishedRevisionId: target.base_published_revision_id,
      }),
      now,
    ),
  ]);
  return false;
}
