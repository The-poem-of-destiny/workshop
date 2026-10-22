import type {
  AdminReferenceSetCreate,
  AdminReferenceVersionCreate,
  AdminReviewRequest,
  AdminSubmissionListQuery,
  AdminSubmissionStatus,
} from "@workshop/contracts";
import { z } from "zod";

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

interface ProjectRow {
  id: string;
  author_id: string;
  author_name: string;
  title: string;
  description: string | null;
  author_note: string | null;
  project_type: string | null;
  extension_type: string | null;
  search_tags: string;
  visibility: "public" | "private";
  working_revision_id: string | null;
  published_revision_id: string | null;
  published_at: string | null;
  downloads_count: number;
  likes_count: number;
  subscriptions_count: number;
  row_version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MemberRow {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  role: "member" | "reviewer" | "owner";
  created_at: string;
  updated_at: string;
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function encodeCursor(offset: number): string {
  return btoa(String(offset));
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const offset = Number(atob(cursor));
    return Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
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
    submission: {
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
    },
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
    SELECT a.r2_key, a.mime, a.bytes
    FROM submissions s
    JOIN assets a ON a.revision_id = s.revision_id
    WHERE s.id = ? AND a.kind = ?
  `)
    .bind(submissionId, kind)
    .first<{ r2_key: string; mime: string; bytes: number }>();
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
    // This guarded project update is the linearization point for approval.
    // Subsequent writes in the same batch require the resulting pointer.
    statements.push(
      db
        .prepare(`
        UPDATE projects
        SET published_revision_id = ?, published_at = ?,
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
          AND projects.deleted_at IS NULL
          AND projects.published_revision_id IS s.base_published_revision_id
          AND projects.published_revision_id IS NOT s.revision_id
          AND NOT EXISTS (SELECT 1 FROM reviews WHERE submission_id = s.id)
      `)
        .bind(target.revision_id, now, now, submissionId, target.revision_id),
    );
  }

  statements.push(
    db
      .prepare(`
      UPDATE submissions
      SET status = ?, resolved_at = ?
      WHERE id = ? AND status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM reviews WHERE submission_id = ?)
        AND (
          ? = 0 OR EXISTS (
            SELECT 1 FROM projects
            WHERE id = ? AND deleted_at IS NULL AND published_revision_id = ?
          )
        )
    `)
      .bind(nextStatus, now, submissionId, submissionId, approval ? 1 : 0, target.project_id, target.revision_id),
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

export async function listAdminProjects(
  db: D1Database,
  limit: number,
  cursor?: string,
  filters: { search?: string; projectType?: string; includeDeleted?: boolean } = {},
) {
  const offset = decodeCursor(cursor);
  const where: string[] = [];
  const bindings: unknown[] = [];
  if (!filters.includeDeleted) where.push("p.deleted_at IS NULL");
  if (filters.projectType) {
    where.push("p.project_type = ?");
    bindings.push(filters.projectType);
  }
  if (filters.search) {
    where.push("(p.title LIKE ? OR p.description LIKE ? OR u.global_name LIKE ? OR u.username LIKE ?)");
    const pattern = `%${filters.search}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  const result = await db
    .prepare(`
    SELECT p.id, p.author_id, COALESCE(u.global_name, u.username) AS author_name,
           p.title, p.description, p.author_note, p.project_type, p.extension_type,
           p.search_tags, p.visibility, p.working_revision_id, p.published_revision_id,
           p.published_at, p.downloads_count, p.likes_count, p.subscriptions_count,
           p.row_version, p.created_at, p.updated_at, p.deleted_at
    FROM projects p JOIN users u ON u.id = p.author_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY p.updated_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `)
    .bind(...bindings, limit + 1, offset)
    .all<ProjectRow>();
  return {
    items: result.results.slice(0, limit).map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      authorNote: row.author_note,
      projectType: row.project_type,
      extensionType: row.extension_type,
      searchTags: parseJson(row.search_tags),
      visibility: row.visibility,
      author: { id: row.author_id, name: row.author_name },
      workingRevisionId: row.working_revision_id,
      publishedRevisionId: row.published_revision_id,
      publishedAt: row.published_at,
      counts: { downloads: row.downloads_count, likes: row.likes_count, subscriptions: row.subscriptions_count },
      rowVersion: row.row_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    })),
    nextCursor: result.results.length > limit ? encodeCursor(offset + limit) : null,
  };
}

export async function listAdminMembers(db: D1Database, limit: number, cursor?: string) {
  const offset = decodeCursor(cursor);
  const result = await db
    .prepare(`
    SELECT id, username, global_name, avatar, role, created_at, updated_at
    FROM users ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?
  `)
    .bind(limit + 1, offset)
    .all<MemberRow>();
  return {
    items: result.results.slice(0, limit).map((row) => ({
      id: row.id,
      username: row.username,
      globalName: row.global_name,
      avatar: row.avatar,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    nextCursor: result.results.length > limit ? encodeCursor(offset + limit) : null,
  };
}

export async function changeAdminMemberRole(
  db: D1Database,
  targetUserId: string,
  role: "member" | "reviewer" | "owner",
  actorId: string,
) {
  const target = await db
    .prepare("SELECT id, role FROM users WHERE id = ?")
    .bind(targetUserId)
    .first<{ id: string; role: "member" | "reviewer" | "owner" }>();
  if (!target) return { kind: "not_found" as const };

  const now = new Date().toISOString();
  const updated = await db
    .prepare(`
    UPDATE users SET role = ?, updated_at = ?
    WHERE id = ?
      AND (role <> 'owner' OR ? = 'owner' OR (SELECT COUNT(*) FROM users WHERE role = 'owner') > 1)
  `)
    .bind(role, now, targetUserId, role)
    .run();
  if (updated.meta.changes === 0) return { kind: "last_owner" as const };

  await db.batch([
    db
      .prepare("UPDATE sessions SET session_version = session_version + 1, revoked_at = ? WHERE user_id = ?")
      .bind(now, targetUserId),
    db
      .prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      VALUES (?, 'member.role_change', 'user', ?, ?, ?, ?)
    `)
      .bind(crypto.randomUUID(), targetUserId, actorId, JSON.stringify({ from: target.role, to: role }), now),
  ]);
  return { kind: "ok" as const };
}
interface AuditEventRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  detail: string | null;
  created_at: string;
}

export async function listAdminAuditEvents(db: D1Database, limit: number, cursor: string | undefined, action?: string) {
  const offset = decodeCursor(cursor);
  const where = action ? "WHERE e.action = ?" : "";
  const result = await db
    .prepare(`
    SELECT e.id, e.action, e.target_type, e.target_id, e.actor_id, e.detail, e.created_at,
           CASE WHEN u.id IS NULL THEN NULL ELSE COALESCE(u.global_name, u.username) END AS actor_name
    FROM audit_events e
    LEFT JOIN users u ON u.id = e.actor_id
    ${where}
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ? OFFSET ?
  `)
    .bind(...(action ? [action] : []), limit + 1, offset)
    .all<AuditEventRow>();
  return {
    items: result.results.slice(0, limit).map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      detail: parseJson(row.detail),
      createdAt: row.created_at,
    })),
    nextCursor: result.results.length > limit ? encodeCursor(offset + limit) : null,
  };
}

export async function updateAdminRecommendation(
  db: D1Database,
  projectId: string,
  actorId: string,
  update: { comment?: string; reaction?: string },
) {
  const project = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first<{ id: string }>();
  if (!project) return { kind: "not_found" as const };
  const existing = await db
    .prepare("SELECT comment, reaction FROM recommendations WHERE curator_id = ? AND project_id = ?")
    .bind(actorId, projectId)
    .first<{ comment: string; reaction: string }>();
  const comment = update.comment ?? existing?.comment ?? "";
  const reaction = update.reaction ?? existing?.reaction ?? "";
  const now = new Date().toISOString();
  const recommendationId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(`
      INSERT INTO recommendations (id, curator_id, project_id, comment, reaction, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(curator_id, project_id) DO UPDATE SET
        comment = excluded.comment, reaction = excluded.reaction, updated_at = excluded.updated_at
    `)
      .bind(recommendationId, actorId, projectId, comment, reaction, now, now),
    db
      .prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      VALUES (?, 'recommendation.update', 'project', ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        projectId,
        actorId,
        JSON.stringify({
          before: existing ? { comment: existing.comment, reaction: existing.reaction } : null,
          after: { comment, reaction },
        }),
        now,
      ),
  ]);
  const row = await db
    .prepare("SELECT id, comment, reaction FROM recommendations WHERE curator_id = ? AND project_id = ?")
    .bind(actorId, projectId)
    .first<{ id: string; comment: string; reaction: string }>();
  return { kind: "ok" as const, id: row?.id ?? recommendationId, comment, reaction };
}

export async function deleteAdminRecommendation(db: D1Database, projectId: string, actorId: string) {
  const existing = await db
    .prepare("SELECT id, comment, reaction FROM recommendations WHERE curator_id = ? AND project_id = ?")
    .bind(actorId, projectId)
    .first<{ id: string; comment: string; reaction: string }>();
  if (!existing) return { kind: "not_found" as const };
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM recommendations WHERE id = ?").bind(existing.id),
    db
      .prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      VALUES (?, 'recommendation.delete', 'project', ?, ?, ?, ?)
    `)
      .bind(crypto.randomUUID(), projectId, actorId, JSON.stringify({ before: existing }), now),
  ]);
  return { kind: "ok" as const };
}

export async function updateAdminReferenceSet(
  db: D1Database,
  id: string,
  actorId: string,
  update: {
    name?: string;
    description?: string | null;
    versionLabel?: string;
    items?: Array<{
      kind: "worldbook" | "regex";
      displayName: string;
      sourceKey?: string | null;
      exactHash?: string;
      normalizedContentHash?: string;
      nameHash?: string;
      keysHash?: string | null;
      structureHash?: string;
    }>;
  },
) {
  const target = await db
    .prepare(`
    SELECT s.name, s.description, v.id AS version_id, v.version_label
    FROM reference_sets s
    JOIN reference_versions v ON v.reference_set_id = s.id
    WHERE s.id = ?
    ORDER BY v.version_ordinal DESC LIMIT 1
  `)
    .bind(id)
    .first<{ name: string; description: string | null; version_id: string; version_label: string }>();
  if (!target) return { kind: "not_found" as const };
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db
      .prepare("UPDATE reference_sets SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .bind(
        update.name ?? target.name,
        update.description === undefined ? target.description : update.description,
        now,
        id,
      ),
    db
      .prepare("UPDATE reference_versions SET version_label = ? WHERE id = ?")
      .bind(update.versionLabel ?? target.version_label, target.version_id),
  ];
  if (update.items !== undefined) {
    statements.push(db.prepare("DELETE FROM reference_items WHERE reference_version_id = ?").bind(target.version_id));
    for (const item of update.items) {
      statements.push(
        db
          .prepare(`
        INSERT INTO reference_items
          (id, reference_version_id, kind, source_key, display_name, exact_hash,
           normalized_content_hash, name_hash, keys_hash, structure_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
          .bind(
            crypto.randomUUID(),
            target.version_id,
            item.kind,
            item.sourceKey ?? null,
            item.displayName,
            item.exactHash ?? "",
            item.normalizedContentHash ?? "",
            item.nameHash ?? "",
            item.keysHash ?? null,
            item.structureHash ?? "",
            now,
          ),
      );
    }
  }
  statements.push(
    db
      .prepare(`
    INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
    VALUES (?, 'reference_set.update', 'reference_set', ?, ?, ?, ?)
  `)
      .bind(
        crypto.randomUUID(),
        id,
        actorId,
        JSON.stringify({
          before: { name: target.name, description: target.description, versionLabel: target.version_label },
          after: update,
        }),
        now,
      ),
  );
  await db.batch(statements);
  return { kind: "ok" as const };
}

export async function updateAdminSite(
  db: D1Database,
  actorId: string,
  banner:
    | {
        imageUrl: string | null;
        positionX: number;
        positionY: number;
        zoom: number;
        mobilePositionX: number;
        mobilePositionY: number;
        mobileZoom: number;
      }
    | undefined,
  siteContent: unknown,
) {
  const current = await db
    .prepare(`
    SELECT key, value FROM site_settings WHERE key IN ('discover_banner', 'site_content')
  `)
    .all<{ key: string; value: string }>();
  const before: Record<string, unknown> = {};
  for (const row of current.results) {
    try {
      before[row.key] = JSON.parse(row.value) as unknown;
    } catch {
      before[row.key] = row.value;
    }
  }
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (banner !== undefined) {
    statements.push(
      db
        .prepare(`
      INSERT INTO site_settings (key, value, updated_at, updated_by) VALUES ('discover_banner', ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `)
        .bind(JSON.stringify(banner), now, actorId),
    );
  }
  if (siteContent !== undefined) {
    statements.push(
      db
        .prepare(`
      INSERT INTO site_settings (key, value, updated_at, updated_by) VALUES ('site_content', ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `)
        .bind(JSON.stringify(siteContent), now, actorId),
    );
  }
  const after = {
    ...(banner === undefined ? {} : { discover_banner: banner }),
    ...(siteContent === undefined ? {} : { site_content: siteContent }),
  };
  statements.push(
    db
      .prepare(`
    INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
    VALUES (?, 'site.update', 'site', 'site', ?, ?, ?)
  `)
      .bind(crypto.randomUUID(), actorId, JSON.stringify({ before, after }), now),
  );
  await db.batch(statements);
  return { banner, siteContent };
}

function referenceItemStatements(
  db: D1Database,
  versionId: string,
  items: AdminReferenceSetCreate["items"] | AdminReferenceVersionCreate["items"],
  now: string,
): D1PreparedStatement[] {
  return items.map((item) =>
    db
      .prepare(`
    INSERT INTO reference_items
      (id, reference_version_id, kind, source_key, display_name, exact_hash,
       normalized_content_hash, name_hash, keys_hash, structure_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
      .bind(
        crypto.randomUUID(),
        versionId,
        item.kind,
        item.sourceKey ?? null,
        item.displayName,
        item.exactHash ?? "",
        item.normalizedContentHash ?? "",
        item.nameHash ?? "",
        item.keysHash ?? null,
        item.structureHash ?? "",
        now,
      ),
  );
}

export async function createAdminReferenceSet(db: D1Database, actorId: string, input: AdminReferenceSetCreate) {
  const now = new Date().toISOString();
  const setId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO reference_sets (id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(setId, input.name, input.description ?? null, actorId, now, now),
    db
      .prepare(`INSERT INTO reference_versions
      (id, reference_set_id, version_label, version_ordinal, grace_until, created_by, created_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)`)
      .bind(versionId, setId, input.versionLabel, input.graceUntil ?? "9999-12-31T00:00:00.000Z", actorId, now),
    ...referenceItemStatements(db, versionId, input.items, now),
    db
      .prepare(`INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      VALUES (?, 'reference_set.create', 'reference_set', ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        setId,
        actorId,
        JSON.stringify({ name: input.name, versionLabel: input.versionLabel, items: input.items.length }),
        now,
      ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) return { kind: "conflict" as const };
    throw error;
  }
  return { kind: "ok" as const, id: setId, versionId };
}

export async function createAdminReferenceVersion(
  db: D1Database,
  actorId: string,
  setId: string,
  input: AdminReferenceVersionCreate,
) {
  const set = await db.prepare("SELECT id FROM reference_sets WHERE id = ?").bind(setId).first<{ id: string }>();
  if (!set) return { kind: "not_found" as const };
  const latest = await db
    .prepare("SELECT MAX(version_ordinal) AS ordinal FROM reference_versions WHERE reference_set_id = ?")
    .bind(setId)
    .first<{ ordinal: number | null }>();
  const now = new Date().toISOString();
  const versionId = crypto.randomUUID();
  const ordinal = (latest?.ordinal ?? 0) + 1;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(`INSERT INTO reference_versions
      (id, reference_set_id, version_label, version_ordinal, grace_until, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        versionId,
        setId,
        input.versionLabel,
        ordinal,
        input.graceUntil ?? "9999-12-31T00:00:00.000Z",
        actorId,
        now,
      ),
    ...referenceItemStatements(db, versionId, input.items, now),
    db
      .prepare(`INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      VALUES (?, 'reference_version.create', 'reference_set', ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        setId,
        actorId,
        JSON.stringify({ versionLabel: input.versionLabel, ordinal, items: input.items.length }),
        now,
      ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) return { kind: "conflict" as const };
    throw error;
  }
  return { kind: "ok" as const, id: versionId, ordinal };
}
