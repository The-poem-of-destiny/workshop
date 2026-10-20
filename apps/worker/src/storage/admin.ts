import type {
  AdminReviewRequest,
  AdminSubmissionListQuery,
} from "@workshop/contracts";
interface SubmissionRow {
  id: string;
  project_id: string;
  revision_id: string;
  status: "pending" | "checking" | "approved" | "rejected" | "superseded";
  gate: string | null;
  checker_revision: string | null;
  submitted_at: string;
  project_title: string;
  author_id: string;
  author_name: string;
}

interface SubmissionTargetRow {
  id: string;
  project_id: string;
  revision_id: string;
  status: SubmissionRow["status"];
  manifest_hash: string | null;
  checker_revision: string | null;
}

interface DetailSubmissionRow extends SubmissionTargetRow {
  gate: string | null;
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
  revision_metadata: string;
  revision_manifest_hash: string | null;
  revision_created_at: string;
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
  report: string | null;
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

export async function listAdminSubmissions(db: D1Database, query: AdminSubmissionListQuery) {
  const offset = decodeCursor(query.cursor);
  const where = query.status ? "WHERE s.status = ?" : "";
  const bindings: unknown[] = query.status ? [query.status] : [];
  const result = await db.prepare(`
    SELECT s.id, s.project_id, s.revision_id, s.status, s.gate,
           s.checker_revision, s.submitted_at,
           p.title AS project_title, u.id AS author_id,
           COALESCE(u.global_name, u.username) AS author_name
    FROM submissions s
    JOIN projects p ON p.id = s.project_id
    JOIN users u ON u.id = p.author_id
    ${where}
    ORDER BY s.submitted_at ASC, s.id ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, query.limit + 1, offset).all<SubmissionRow>();

  const rows = result.results.slice(0, query.limit);
  return {
    items: rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      projectTitle: row.project_title,
      author: { id: row.author_id, name: row.author_name },
      status: row.status,
      gate: row.gate,
      checkerRevision: row.checker_revision,
      submittedAt: row.submitted_at,
    })),
    nextCursor: result.results.length > query.limit ? encodeCursor(offset + query.limit) : null,
  };
}

export async function getAdminSubmission(db: D1Database, id: string) {
  const row = await db.prepare(`
    SELECT s.id, s.project_id, s.revision_id, s.status, s.gate,
           s.checker_revision, s.submitted_by, s.submitted_at, s.resolved_at,
           r.manifest_hash,
           p.title AS project_title, p.description AS project_description,
           p.visibility AS project_visibility, p.author_id AS project_author_id,
           COALESCE(u.global_name, u.username) AS project_author_name,
           r.revision_no, r.title AS revision_title, r.description AS revision_description,
           r.author_note AS revision_author_note, r.project_type AS revision_project_type,
           r.extension_type AS revision_extension_type, r.tags AS revision_tags,
           r.metadata AS revision_metadata, r.manifest_hash AS revision_manifest_hash,
           r.created_at AS revision_created_at
    FROM submissions s
    JOIN projects p ON p.id = s.project_id
    JOIN users u ON u.id = p.author_id
    JOIN project_revisions r ON r.id = s.revision_id
    WHERE s.id = ?
  `).bind(id).first<DetailSubmissionRow>();
  if (!row) return null;

  const [assets, review] = await Promise.all([
    db.prepare(`
      SELECT id, kind, sha256, bytes, mime, r2_key
      FROM assets WHERE revision_id = ? ORDER BY kind ASC, id ASC
    `).bind(row.revision_id).all<AssetRow>(),
    db.prepare(`
      SELECT id, submission_id, reviewer_id, decision, reason, manifest_hash,
             checker_version, report, created_at
      FROM reviews WHERE submission_id = ?
    `).bind(id).first<ReviewRow>(),
  ]);

  return {
    submission: {
      id: row.id,
      projectId: row.project_id,
      revisionId: row.revision_id,
      status: row.status,
      gate: row.gate,
      checkerRevision: row.checker_revision,
      submittedBy: row.submitted_by,
      submittedAt: row.submitted_at,
      resolvedAt: row.resolved_at,
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
      metadata: parseJson(row.revision_metadata),
      manifestHash: row.revision_manifest_hash,
      createdAt: row.revision_created_at,
    },
    assets: assets.results.map(asset => ({
      id: asset.id,
      kind: asset.kind,
      sha256: asset.sha256,
      bytes: asset.bytes,
      mime: asset.mime,
      r2Key: asset.r2_key,
    })),
    review: review ? {
      id: review.id,
      submissionId: review.submission_id,
      reviewerId: review.reviewer_id,
      decision: review.decision,
      reason: review.reason,
      manifestHash: review.manifest_hash,
      checkerVersion: review.checker_version,
      report: parseJson(review.report),
      createdAt: review.created_at,
    } : null,
  };
}

export async function getSubmissionAsset(
  db: D1Database,
  submissionId: string,
  kind: "worldbook" | "regex",
) {
  return db.prepare(`
    SELECT a.r2_key, a.mime, a.bytes
    FROM submissions s
    JOIN assets a ON a.revision_id = s.revision_id
    WHERE s.id = ? AND a.kind = ?
  `).bind(submissionId, kind).first<{ r2_key: string; mime: string; bytes: number }>();
}

export async function reviewAdminSubmission(
  db: D1Database,
  submissionId: string,
  reviewerId: string,
  request: AdminReviewRequest,
) {
  const target = await db.prepare(`
    SELECT s.id, s.project_id, s.revision_id, s.status,
           r.manifest_hash, s.checker_revision
    FROM submissions s
    JOIN project_revisions r ON r.id = s.revision_id
    WHERE s.id = ?
  `).bind(submissionId).first<SubmissionTargetRow>();
  if (!target) return { kind: "not_found" as const };
  if (target.status !== "pending") return { kind: "conflict" as const };
  if (request.decision === "approve" && !target.manifest_hash) return { kind: "conflict" as const };

  const now = new Date().toISOString();
  const nextStatus = request.decision === "approve" ? "approved" : "rejected";
  const checkerVersion = request.checkerVersion ?? target.checker_revision;
  const report = request.report === undefined ? null : JSON.stringify(request.report);
  const reviewId = crypto.randomUUID();

  const statements = [
    db.prepare(`
      UPDATE submissions
      SET status = ?, resolved_at = ?
      WHERE id = ? AND status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM reviews WHERE submission_id = ?)
    `).bind(nextStatus, now, submissionId, submissionId),
    db.prepare(`
      INSERT INTO reviews
        (id, submission_id, reviewer_id, decision, reason, manifest_hash, checker_version, report, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = ?)
    `).bind(
      reviewId, submissionId, reviewerId, request.decision, request.reason ?? null,
      target.manifest_hash, checkerVersion, report, now, submissionId, nextStatus,
    ),
    db.prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      SELECT ?, ?, 'submission', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM reviews WHERE id = ?)
    `).bind(
      crypto.randomUUID(),
      `review.${request.decision}`,
      submissionId,
      reviewerId,
      JSON.stringify({ projectId: target.project_id, revisionId: target.revision_id, checkerVersion }),
      now,
      reviewId,
    ),
  ];

  if (request.decision === "approve") {
    statements.push(db.prepare(`
      UPDATE projects
      SET published_revision_id = ?, published_at = ?,
          title = r.title, description = r.description, author_note = r.author_note,
          project_type = r.project_type, extension_type = r.extension_type,
          search_tags = r.tags, row_version = row_version + 1, updated_at = ?
      FROM project_revisions r
      WHERE projects.id = ? AND r.id = ?
        AND EXISTS (SELECT 1 FROM reviews WHERE submission_id = ?)
        AND EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = 'approved')
    `).bind(target.revision_id, now, now, target.project_id, target.revision_id, submissionId, submissionId));
  }

  try {
    const results = await db.batch(statements);
    if ((results[1]?.meta.changes ?? 0) === 0) return { kind: "conflict" as const };
  } catch (error) {
    // UNIQUE(reviews.submission_id) and the conditional update make races a 409.
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      return { kind: "conflict" as const };
    }
    throw error;
  }
  return { kind: "ok" as const, id: reviewId, status: nextStatus };
}

export async function listAdminProjects(db: D1Database, limit: number, cursor?: string) {
  const offset = decodeCursor(cursor);
  const result = await db.prepare(`
    SELECT p.id, p.author_id, COALESCE(u.global_name, u.username) AS author_name,
           p.title, p.description, p.author_note, p.project_type, p.extension_type,
           p.search_tags, p.visibility, p.working_revision_id, p.published_revision_id,
           p.published_at, p.downloads_count, p.likes_count, p.subscriptions_count,
           p.row_version, p.created_at, p.updated_at, p.deleted_at
    FROM projects p JOIN users u ON u.id = p.author_id
    ORDER BY p.updated_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).bind(limit + 1, offset).all<ProjectRow>();
  return {
    items: result.results.slice(0, limit).map(row => ({
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
  const result = await db.prepare(`
    SELECT id, username, global_name, avatar, role, created_at, updated_at
    FROM users ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?
  `).bind(limit + 1, offset).all<MemberRow>();
  return {
    items: result.results.slice(0, limit).map(row => ({
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
  const target = await db.prepare("SELECT id, role FROM users WHERE id = ?").bind(targetUserId)
    .first<{ id: string; role: "member" | "reviewer" | "owner" }>();
  if (!target) return { kind: "not_found" as const };

  const now = new Date().toISOString();
  const updated = await db.prepare(`
    UPDATE users SET role = ?, updated_at = ?
    WHERE id = ?
      AND (role <> 'owner' OR ? = 'owner' OR (SELECT COUNT(*) FROM users WHERE role = 'owner') > 1)
  `).bind(role, now, targetUserId, role).run();
  if (updated.meta.changes === 0) return { kind: "last_owner" as const };

  await db.batch([
    db.prepare("UPDATE sessions SET session_version = session_version + 1, revoked_at = ? WHERE user_id = ?")
      .bind(now, targetUserId),
    db.prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      VALUES (?, 'member.role_change', 'user', ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), targetUserId, actorId, JSON.stringify({ from: target.role, to: role }), now),
  ]);
  return { kind: "ok" as const };
}
