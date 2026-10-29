import type { AdminReviewRequest, AdminSubmissionListQuery, AdminSubmissionStatus } from "@workshop/contracts";
import { z } from "zod";
import { parseJson } from "./admin-values.js";

interface SubmissionRow {
  id: string;
  project_id: string;
  revision_id: string;
  status: "pending" | "checking" | "approved" | "rejected" | "superseded";
  gate: string | null;
  checker_revision: string | null;
  submitted_at: string;
  check_status: string;
  project_title: string;
  author_id: string;
  author_name: string;
}

interface SubmissionTargetRow {
  id: string;
  project_id: string;
  revision_id: string;
  base_published_revision_id: string | null;
  status: SubmissionRow["status"];
  manifest_hash: string | null;
  review_checker_revision: string | null;
  check_status: string;
  check_report: string | null;
  check_report_hash: string | null;
  client_gate: string | null;
}

function reportGate(value: string | null): string | null {
  const parsed = z.object({ routeGate: z.string().optional() }).passthrough().safeParse(parseJson(value));
  return parsed.success ? (parsed.data.routeGate ?? null) : null;
}

interface DetailSubmissionRow extends SubmissionTargetRow {
  submitted_by: string;
  submitted_at: string;
  resolved_at: string | null;
  project_title: string;
  project_description: string | null;
  project_visibility: "public" | "private";
  project_author_id: string;
  project_author_name: string;
  revision_no: number;
  revision_title: string;
  revision_description: string | null;
  revision_author_note: string | null;
  revision_project_type: string | null;
  revision_extension_type: string | null;
  revision_tags: string;
  revision_manifest_hash: string | null;
  revision_created_at: string;
  client_gate: string | null;
  client_checker_revision: string | null;
  client_warning_count: number;
  client_acknowledged_at: string | null;
  check_status: string;
  check_attempts: number;
  check_error: string | null;
  check_report: string | null;
  check_report_hash: string | null;
  checked_at: string | null;
  review_checker_revision: string | null;
  auto_published_at: string | null;
}

interface AssetRow {
  id: string;
  kind: string;
  sha256: string;
  bytes: number;
  mime: string;
  r2_key: string;
}

interface ReviewRow {
  id: string;
  submission_id: string;
  reviewer_id: string;
  decision: "approve" | "reject";
  reason: string | null;
  manifest_hash: string | null;
  checker_version: string | null;
  created_at: string;
}

function encodeSubmissionCursor(row: { submitted_at: string; id: string }): string {
  return btoa(JSON.stringify([row.submitted_at, row.id]))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeSubmissionCursor(cursor: string | undefined): [string, string] | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [submittedAt, id] = parsed;
    return typeof submittedAt === "string" && typeof id === "string" ? [submittedAt, id] : null;
  } catch {
    return null;
  }
}

export async function listAdminSubmissions(db: D1Database, query: AdminSubmissionListQuery) {
  const statuses = query.status;
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (statuses.length > 0) {
    conditions.push(`s.status IN (${statuses.map(() => "?").join(",")})`);
    bindings.push(...statuses);
  }
  const after = decodeSubmissionCursor(query.cursor);
  if (after) {
    conditions.push("(s.submitted_at > ? OR (s.submitted_at = ? AND s.id > ?))");
    bindings.push(after[0], after[0], after[1]);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const [result, countRows] = await Promise.all([
    db
      .prepare(`
    SELECT s.id, s.project_id, s.revision_id, s.status, s.client_gate AS gate,
           s.client_checker_revision AS checker_revision, s.submitted_at, s.check_status,
           p.title AS project_title, u.id AS author_id,
           COALESCE(u.global_name, u.username) AS author_name
    FROM submissions s
    JOIN projects p ON p.id = s.project_id
    JOIN users u ON u.id = p.author_id
    ${where}
    ORDER BY s.submitted_at ASC, s.id ASC
    LIMIT ?
  `)
      .bind(...bindings, query.limit + 1)
      .all<SubmissionRow>(),
    db.prepare("SELECT status, COUNT(*) AS count FROM submissions GROUP BY status").all<{
      status: AdminSubmissionStatus;
      count: number;
    }>(),
  ]);

  const counts: Record<AdminSubmissionStatus, number> = {
    pending: 0,
    checking: 0,
    approved: 0,
    rejected: 0,
    superseded: 0,
  };
  for (const row of countRows.results) counts[row.status] = row.count;

  const rows = result.results.slice(0, query.limit);
  const last = rows.at(-1);
  return {
    counts,
    items: rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectTitle: row.project_title,
      author: { id: row.author_id, name: row.author_name },
      status: row.status,
      gate: row.gate,
      checkerRevision: row.checker_revision,
      checkStatus: row.check_status,
      submittedAt: row.submitted_at,
    })),
    nextCursor: result.results.length > query.limit && last ? encodeSubmissionCursor(last) : null,
  };
}

function submissionDetail(row: DetailSubmissionRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    revisionId: row.revision_id,
    status: row.status,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    resolvedAt: row.resolved_at,
    clientGate: row.client_gate,
    clientCheckerRevision: row.client_checker_revision,
    clientWarningCount: row.client_warning_count,
    clientAcknowledgedAt: row.client_acknowledged_at,
    checkStatus: row.check_status,
    checkAttempts: row.check_attempts,
    checkError: row.check_error,
    checkReport: parseJson(row.check_report),
    checkReportHash: row.check_report_hash,
    checkedAt: row.checked_at,
    reviewCheckerRevision: row.review_checker_revision,
    autoPublishedAt: row.auto_published_at,
  };
}

export async function getAdminSubmission(db: D1Database, id: string) {
  const row = await db
    .prepare(`
    SELECT s.id, s.project_id, s.revision_id, s.status,
           s.submitted_by, s.submitted_at, s.resolved_at,
           s.client_gate, s.client_checker_revision, s.client_warning_count, s.client_acknowledged_at,
           s.check_status, s.check_attempts, s.check_error, s.check_report, s.check_report_hash,
           s.checked_at, s.review_checker_revision, s.auto_published_at,
           r.manifest_hash,
           p.title AS project_title, p.description AS project_description,
           p.visibility AS project_visibility, p.author_id AS project_author_id,
           COALESCE(u.global_name, u.username) AS project_author_name,
           r.revision_no, r.title AS revision_title, r.description AS revision_description,
           r.author_note AS revision_author_note, r.project_type AS revision_project_type,
           r.extension_type AS revision_extension_type, r.tags AS revision_tags,
           r.manifest_hash AS revision_manifest_hash,
           r.created_at AS revision_created_at
    FROM submissions s
    JOIN projects p ON p.id = s.project_id
    JOIN users u ON u.id = p.author_id
    JOIN project_revisions r ON r.id = s.revision_id
    WHERE s.id = ?
  `)
    .bind(id)
    .first<DetailSubmissionRow>();
  if (!row) return null;

  const [assets, review, checkRuns] = await Promise.all([
    db
      .prepare(`
      SELECT id, kind, sha256, bytes, mime, r2_key
      FROM assets WHERE revision_id = ? ORDER BY kind ASC, id ASC
    `)
      .bind(row.revision_id)
      .all<AssetRow>(),
    db
      .prepare(`
      SELECT id, submission_id, reviewer_id, decision, reason, manifest_hash,
             checker_version, created_at
      FROM reviews WHERE submission_id = ?
    `)
      .bind(id)
      .first<ReviewRow>(),
    db
      .prepare(`
      SELECT id, review_checker_revision, route_gate, report, report_hash, duration_ms, created_at
      FROM submission_check_runs WHERE submission_id = ? ORDER BY created_at DESC
    `)
      .bind(id)
      .all<{
        id: string;
        review_checker_revision: string;
        route_gate: string;
        report: string;
        report_hash: string;
        duration_ms: number;
        created_at: string;
      }>(),
  ]);

  return {
    submission: submissionDetail(row),
    project: {
      id: row.project_id,
      title: row.project_title,
      description: row.project_description,
      visibility: row.project_visibility,
      author: { id: row.project_author_id, name: row.project_author_name },
    },
    revision: {
      id: row.revision_id,
      revisionNo: row.revision_no,
      title: row.revision_title,
      description: row.revision_description,
      authorNote: row.revision_author_note,
      projectType: row.revision_project_type,
      extensionType: row.revision_extension_type,
      searchTags: parseJson(row.revision_tags),
      manifestHash: row.revision_manifest_hash,
      createdAt: row.revision_created_at,
    },
    assets: assets.results.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      sha256: asset.sha256,
      bytes: asset.bytes,
      mime: asset.mime,
      r2Key: asset.r2_key,
    })),
    checkRuns: checkRuns.results.map((run) => ({
      id: run.id,
      reviewCheckerRevision: run.review_checker_revision,
      routeGate: run.route_gate,
      report: parseJson(run.report),
      reportHash: run.report_hash,
      durationMs: run.duration_ms,
      createdAt: run.created_at,
    })),
    review: review
      ? {
          id: review.id,
          submissionId: review.submission_id,
          reviewerId: review.reviewer_id,
          decision: review.decision,
          reason: review.reason,
          manifestHash: review.manifest_hash,
          checkerVersion: review.checker_version,
          createdAt: review.created_at,
        }
      : null,
  };
}

export async function getSubmissionAsset(db: D1Database, submissionId: string, kind: "worldbook" | "regex" | "cover") {
  return db
    .prepare(`
    SELECT a.r2_key, a.mime, a.bytes, a.sha256
    FROM submissions s
    JOIN assets a ON a.revision_id = s.revision_id
    WHERE s.id = ? AND a.kind = ?
  `)
    .bind(submissionId, kind)
    .first<{ r2_key: string; mime: string; bytes: number; sha256: string }>();
}

function approvalStatement(db: D1Database, target: SubmissionTargetRow, submissionId: string, now: string) {
  // This guarded project update is the linearization point for approval.
  // Subsequent writes in the same batch require the resulting pointer.
  return db
    .prepare(`
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
          AND s.id = ? AND s.status = 'pending'
          AND s.revision_id = ?
          AND s.check_status NOT IN ('queued', 'running')
          AND s.check_report_hash IS ? AND s.review_checker_revision IS ?
          AND r.manifest_hash IS ?
          AND projects.deleted_at IS NULL
          AND projects.published_revision_id IS s.base_published_revision_id
          AND projects.published_revision_id IS NOT s.revision_id
          AND NOT EXISTS (SELECT 1 FROM reviews WHERE submission_id = s.id)
      `)
    .bind(
      target.revision_id,
      now,
      now,
      submissionId,
      target.revision_id,
      target.check_report_hash,
      target.review_checker_revision,
      target.manifest_hash,
    );
}

export async function reviewAdminSubmission(
  db: D1Database,
  submissionId: string,
  reviewerId: string,
  request: AdminReviewRequest,
) {
  const target = await db
    .prepare(`
    SELECT s.id, s.project_id, s.revision_id, s.base_published_revision_id, s.status,
           r.manifest_hash, s.review_checker_revision,
           s.check_status, s.check_report, s.check_report_hash, s.client_gate
    FROM submissions s
    JOIN project_revisions r ON r.id = s.revision_id
    WHERE s.id = ?
  `)
    .bind(submissionId)
    .first<SubmissionTargetRow>();
  if (!target) return { kind: "not_found" as const };
  if (target.status !== "pending") return { kind: "conflict" as const };
  if (request.revisionId && request.revisionId !== target.revision_id) return { kind: "conflict" as const };
  if (request.manifestHash && request.manifestHash !== target.manifest_hash) return { kind: "conflict" as const };
  if (request.reportHash && request.reportHash !== target.check_report_hash) return { kind: "conflict" as const };
  if (target.check_status === "queued" || target.check_status === "running") {
    return { kind: "conflict" as const };
  }
  if (request.decision === "reject" && !request.reason?.trim()) {
    return { kind: "invalid_reason" as const };
  }
  const serverGate = reportGate(target.check_report);
  if (
    request.decision === "approve" &&
    (target.client_gate === "block" || target.client_gate === "missing" || serverGate === "block") &&
    !request.reason?.trim()
  ) {
    return { kind: "invalid_reason" as const };
  }
  if (request.decision === "approve" && !target.manifest_hash) return { kind: "conflict" as const };

  const now = new Date().toISOString();
  const nextStatus = request.decision === "approve" ? "approved" : "rejected";
  const checkerVersion = target.review_checker_revision;
  const reviewId = crypto.randomUUID();
  const approval = request.decision === "approve";
  const statements: D1PreparedStatement[] = [];

  if (approval) {
    statements.push(approvalStatement(db, target, submissionId, now));
  }

  statements.push(
    db
      .prepare(`
      UPDATE submissions
      SET status = ?, resolved_at = ?
      WHERE id = ? AND status = 'pending'
        AND check_status NOT IN ('queued', 'running')
        AND check_report_hash IS ? AND review_checker_revision IS ?
        AND EXISTS (SELECT 1 FROM project_revisions r WHERE r.id = submissions.revision_id AND r.manifest_hash IS ?)
        AND NOT EXISTS (SELECT 1 FROM reviews WHERE submission_id = ?)
        AND (
          ? = 0 OR EXISTS (
            SELECT 1 FROM projects
            WHERE id = ? AND deleted_at IS NULL AND published_revision_id = ?
          )
        )
    `)
      .bind(
        nextStatus,
        now,
        submissionId,
        target.check_report_hash,
        target.review_checker_revision,
        target.manifest_hash,
        submissionId,
        approval ? 1 : 0,
        target.project_id,
        target.revision_id,
      ),
    db
      .prepare(`
      INSERT INTO reviews
        (id, submission_id, reviewer_id, decision, reason, manifest_hash, checker_version, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = ?)
    `)
      .bind(
        reviewId,
        submissionId,
        reviewerId,
        request.decision,
        request.reason ?? null,
        target.manifest_hash,
        checkerVersion,
        now,
        submissionId,
        nextStatus,
      ),
    db
      .prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      SELECT ?, ?, 'submission', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM reviews WHERE id = ?)
    `)
      .bind(
        crypto.randomUUID(),
        `review.${request.decision}`,
        submissionId,
        reviewerId,
        JSON.stringify({
          projectId: target.project_id,
          revisionId: target.revision_id,
          checkerVersion,
          reason: request.reason ?? null,
        }),
        now,
        reviewId,
      ),
  );

  try {
    const results = await db.batch(statements);
    const statusIndex = approval ? 1 : 0;
    if ((results[statusIndex]?.meta.changes ?? 0) === 0) return { kind: "conflict" as const };
  } catch (error) {
    // UNIQUE(reviews.submission_id) and the conditional transition make races a 409.
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      return { kind: "conflict" as const };
    }
    throw error;
  }
  return { kind: "ok" as const, id: reviewId, status: nextStatus };
}
