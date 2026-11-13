import type { AdminReviewRequest, AdminSubmissionListQuery, AdminSubmissionStatus, ProjectType } from "@workshop/contracts";
import { parseJson } from "./admin-values.js";
import { parseIncludedTypes } from "./authoring-model.js";
import { readFrozenReviewReport } from "./review-reports";

interface SubmissionRow {
  id: string;
  project_id: string;
  version_id: string;
  status: "pending" | "checking" | "approved" | "rejected" | "superseded";
  gate: string | null;
  checker_version: string | null;
  submitted_at: string;
  check_status: string;
  project_title: string;
  author_id: string;
  author_name: string;
}

interface SubmissionTargetRow {
  id: string;
  project_id: string;
  version_id: string;
  base_published_version_id: string | null;
  status: SubmissionRow["status"];
  manifest_hash: string | null;
  checker_version: string | null;
  check_status: string;
  route_gate: string | null;
  check_report_hash: string | null;
  client_gate: string | null;
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
  version_no: number;
  version_title: string;
  version_description: string | null;
  version_project_type: ProjectType;
  version_included_types: string;
  version_tags: string;
  version_manifest_hash: string | null;
  version_created_at: string;
  client_gate: string | null;
  client_checker_version: string | null;
  check_status: string;
  check_attempts: number;
  check_error: string | null;
  report_r2_key: string | null;
  check_report_hash: string | null;
  report_cleaned_at: string | null;
  route_gate: string | null;
  duration_ms: number | null;
  checked_at: string | null;
  checker_version: string | null;
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
    SELECT s.id, s.project_id, s.version_id, s.status, ar.client_gate AS gate,
           ar.client_checker_version AS checker_version, s.submitted_at, ar.status AS check_status,
           r.title AS project_title, u.id AS author_id,
           COALESCE(u.global_name, u.username) AS author_name
    FROM submissions s
    JOIN automated_reviews ar ON ar.submission_id = s.id
    JOIN projects p ON p.id = s.project_id
    JOIN project_versions r ON r.id = s.version_id
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
      checkerVersion: row.checker_version,
      checkStatus: row.check_status,
      submittedAt: row.submitted_at,
    })),
    nextCursor: result.results.length > query.limit && last ? encodeSubmissionCursor(last) : null,
  };
}

function submissionDetail(row: DetailSubmissionRow, report: string | null) {
  return {
    id: row.id,
    projectId: row.project_id,
    versionId: row.version_id,
    status: row.status,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    resolvedAt: row.resolved_at,
    clientGate: row.client_gate,
    clientCheckerVersion: row.client_checker_version,
    checkStatus: row.check_status,
    checkAttempts: row.check_attempts,
    checkError: row.check_error,
    checkReport: parseJson(report),
    checkReportHash: row.check_report_hash,
    reportCleanedAt: row.report_cleaned_at,
    routeGate: row.route_gate,
    durationMs: row.duration_ms,
    checkedAt: row.checked_at,
    checkerVersion: row.checker_version,
    autoPublishedAt: row.auto_published_at,
  };
}

export async function getAdminSubmission(db: D1Database, r2: R2Bucket, id: string) {
  const row = await db
    .prepare(`
    SELECT s.id, s.project_id, s.version_id, s.status,
           s.submitted_by, s.submitted_at, s.resolved_at,
           ar.client_gate, ar.client_checker_version AS client_checker_version,
           ar.status AS check_status, ar.attempts AS check_attempts, ar.error AS check_error,
           ar.report_r2_key, ar.report_hash AS check_report_hash, ar.report_cleaned_at, ar.route_gate,
           ar.duration_ms, ar.checked_at, ar.checker_version AS checker_version, s.auto_published_at,
           r.manifest_hash,
           r.title AS project_title, r.description AS project_description,
           p.visibility AS project_visibility, p.author_id AS project_author_id,
           COALESCE(u.global_name, u.username) AS project_author_name,
           r.version_no, r.title AS version_title, r.description AS version_description,
           r.project_type AS version_project_type,
           r.included_types AS version_included_types, r.tags AS version_tags,
           r.manifest_hash AS version_manifest_hash,
           r.created_at AS version_created_at
    FROM submissions s
    JOIN automated_reviews ar ON ar.submission_id = s.id
    JOIN projects p ON p.id = s.project_id
    JOIN users u ON u.id = p.author_id
    JOIN project_versions r ON r.id = s.version_id
    WHERE s.id = ?
  `)
    .bind(id)
    .first<DetailSubmissionRow>();
  if (!row) return null;

  const [assets, review, reportObject] = await Promise.all([
    db
      .prepare(`
      SELECT id, kind, sha256, bytes, mime, r2_key
      FROM assets WHERE version_id = ? ORDER BY kind ASC, id ASC
    `)
      .bind(row.version_id)
      .all<AssetRow>(),
    db
      .prepare(`
      SELECT id, submission_id, reviewer_id, decision, reason, manifest_hash,
             checker_version, created_at
      FROM manual_reviews WHERE submission_id = ?
    `)
      .bind(id)
      .first<ReviewRow>(),
    readFrozenReviewReport(r2, row.report_r2_key, row.check_report_hash, row.report_cleaned_at),
  ]);

  return {
    submission: submissionDetail(row, reportObject),
    project: {
      id: row.project_id,
      title: row.project_title,
      description: row.project_description,
      visibility: row.project_visibility,
      author: { id: row.project_author_id, name: row.project_author_name },
    },
    version: {
      id: row.version_id,
      versionNo: row.version_no,
      title: row.version_title,
      description: row.version_description,
      projectType: row.version_project_type,
      includedTypes: parseIncludedTypes(row.version_included_types),
      searchTags: parseJson(row.version_tags),
      manifestHash: row.version_manifest_hash,
      createdAt: row.version_created_at,
    },
    assets: assets.results.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      sha256: asset.sha256,
      bytes: asset.bytes,
      mime: asset.mime,
      r2Key: asset.r2_key,
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
    JOIN assets a ON a.version_id = s.version_id
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
        SET published_version_id = ?, published_at = ?, published_updated_at = ?, published_cover_asset_id = NULL,
            row_version = row_version + 1, updated_at = ?
        FROM submissions s
        JOIN project_versions r ON r.id = s.version_id
        WHERE projects.id = s.project_id
          AND s.id = ? AND s.status = 'pending'
          AND s.version_id = ?
          AND EXISTS (SELECT 1 FROM automated_reviews ar WHERE ar.submission_id = s.id
            AND ar.status NOT IN ('queued','running') AND ar.report_hash IS ? AND ar.checker_version IS ?)
          AND r.manifest_hash IS ?
          AND projects.deleted_at IS NULL
          AND projects.published_version_id IS s.base_published_version_id
          AND projects.published_version_id IS NOT s.version_id
          AND NOT EXISTS (SELECT 1 FROM manual_reviews WHERE submission_id = s.id)
      `)
    .bind(
      target.version_id,
      now,
      now,
      now,
      submissionId,
      target.version_id,
      target.check_report_hash,
      target.checker_version,
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
    SELECT s.id, s.project_id, s.version_id, s.base_published_version_id, s.status,
           r.manifest_hash, ar.checker_version,
           ar.status AS check_status, ar.route_gate, ar.report_hash AS check_report_hash, ar.client_gate
    FROM submissions s JOIN automated_reviews ar ON ar.submission_id = s.id
    JOIN project_versions r ON r.id = s.version_id
    WHERE s.id = ?
  `)
    .bind(submissionId)
    .first<SubmissionTargetRow>();
  if (!target) return { kind: "not_found" as const };
  if (target.status !== "pending") return { kind: "conflict" as const };
  if (request.versionId && request.versionId !== target.version_id) return { kind: "conflict" as const };
  if (request.manifestHash && request.manifestHash !== target.manifest_hash) return { kind: "conflict" as const };
  if (request.reportHash && request.reportHash !== target.check_report_hash) return { kind: "conflict" as const };
  if (target.check_status === "queued" || target.check_status === "running") {
    return { kind: "conflict" as const };
  }
  if (request.decision === "reject" && !request.reason?.trim()) {
    return { kind: "invalid_reason" as const };
  }
  const serverGate = target.route_gate;
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
  const checkerVersion = target.checker_version;
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
        AND EXISTS (SELECT 1 FROM automated_reviews ar WHERE ar.submission_id = submissions.id
          AND ar.status NOT IN ('queued','running') AND ar.report_hash IS ? AND ar.checker_version IS ?)
        AND EXISTS (SELECT 1 FROM project_versions r WHERE r.id = submissions.version_id AND r.manifest_hash IS ?)
        AND NOT EXISTS (SELECT 1 FROM manual_reviews WHERE submission_id = ?)
        AND (
          ? = 0 OR EXISTS (
            SELECT 1 FROM projects
            WHERE id = ? AND deleted_at IS NULL AND published_version_id = ?
          )
        )
    `)
      .bind(
        nextStatus,
        now,
        submissionId,
        target.check_report_hash,
        target.checker_version,
        target.manifest_hash,
        submissionId,
        approval ? 1 : 0,
        target.project_id,
        target.version_id,
      ),
    db
      .prepare(`
      INSERT INTO manual_reviews
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
