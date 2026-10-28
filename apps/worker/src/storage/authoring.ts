import type {
  AuthorProject,
  AuthorSubmission,
  CreateProject,
  ProjectSummary,
  Session,
  VisibilityUpdate,
} from "@workshop/contracts";
import { getAuthoringProject, metadataSnapshot, parseTags, type RevisionValues } from "./authoring-model.js";

interface SummaryRow {
  id: string;
  title: string;
  description: string | null;
  project_type: string | null;
  extension_type: string | null;
  visibility: "public" | "private";
  published_at: string | null;
  updated_at: string;
  published_revision_id: string | null;
  downloads_count: number;
  likes_count: number;
  subscriptions_count: number;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  tags: string;
  worldbook_count: number;
  regex_count: number;
  schema_version: string | null;
  author_note: string | null;
  discord_thread_url: string | null;
  version_label: string | null;
  cover_position_x: number;
  cover_position_y: number;
  cover_zoom: number;
  cover_key: string | null;
  gallery: string;
}

export interface AuthoringProject {
  project: ProjectSummary;
  rowVersion: number;
  workingRevisionId: string;
}

function avatarUrl(userId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  return avatar.startsWith("https://") ? avatar : `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`;
}
function parseGallery(value: string): Array<{ slot: number; url: string }> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is { slot: number; url: string } =>
        typeof item === "object" &&
        item !== null &&
        "slot" in item &&
        typeof item.slot === "number" &&
        "url" in item &&
        typeof item.url === "string",
    );
  } catch {
    return [];
  }
}

function toSummary(row: SummaryRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    author: { id: row.author_id, name: row.author_name, avatarUrl: avatarUrl(row.author_id, row.author_avatar) },
    projectType: row.project_type as ProjectSummary["projectType"],
    extensionType: row.extension_type as ProjectSummary["extensionType"],
    tags: parseTags(row.tags),
    entries: { worldbook: row.worldbook_count, regex: row.regex_count },
    schemaVersion: row.schema_version,
    authorNote: row.author_note,
    discordThreadUrl: row.discord_thread_url,
    versionLabel: row.version_label,
    coverPositionX: row.cover_position_x,
    coverPositionY: row.cover_position_y,
    coverZoom: row.cover_zoom,
    coverUrl: row.cover_key ? `/api/v1/assets/${row.cover_key}` : null,
    gallery: parseGallery(row.gallery),
    counts: { downloads: row.downloads_count, likes: row.likes_count, subscriptions: row.subscriptions_count },
    visibility: row.visibility,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    publishedRevisionId: row.published_revision_id,
  };
}

const summarySql = `
  SELECT p.id, COALESCE(r.title, p.title) AS title,
    COALESCE(r.description, p.description) AS description,
    COALESCE(r.project_type, p.project_type) AS project_type,
    COALESCE(r.extension_type, p.extension_type) AS extension_type,
    p.visibility, p.published_at, p.updated_at, p.published_revision_id, p.downloads_count, p.likes_count,
    p.subscriptions_count, u.id AS author_id, COALESCE(u.global_name, u.username) AS author_name,
    u.avatar AS author_avatar, COALESCE(r.tags, p.search_tags) AS tags,
    COALESCE(r.worldbook_count, 0) AS worldbook_count, COALESCE(r.regex_count, 0) AS regex_count,
    r.schema_version, COALESCE(r.author_note, p.author_note) AS author_note,
    r.discord_thread_url, COALESCE(r.version_label, p.version_label) AS version_label,
    COALESCE(r.cover_position_x, p.cover_position_x) AS cover_position_x,
    COALESCE(r.cover_position_y, p.cover_position_y) AS cover_position_y,
    COALESCE(r.cover_zoom, p.cover_zoom) AS cover_zoom,
    (SELECT a.r2_key FROM assets a WHERE a.revision_id = p.working_revision_id AND a.kind = 'cover' LIMIT 1) AS cover_key,
    COALESCE(
      (SELECT json_group_array(json_object('slot', g.slot, 'url', '/api/v1/assets/' || g.r2_key))
       FROM project_gallery g WHERE g.project_id = p.id),
      '[]'
    ) AS gallery
  FROM projects p JOIN users u ON u.id = p.author_id
  LEFT JOIN project_revisions r ON r.id = p.working_revision_id
  WHERE p.id = ? AND p.deleted_at IS NULL
`;

export async function getProjectSummary(db: D1Database, projectId: string): Promise<ProjectSummary | null> {
  const row = await db.prepare(summarySql).bind(projectId).first<SummaryRow>();
  return row ? toSummary(row) : null;
}

interface AuthorProjectRow extends SummaryRow {
  author_note: string | null;
  precautions: string | null;
  metadata_findings: string | null;
  row_version: number;
  working_revision_id: string | null;
  submission_id: string | null;
  submission_revision_id: string | null;
  submission_status: AuthorSubmission["status"] | null;
  submission_gate: string | null;
  submission_checker_revision: string | null;
  submission_submitted_at: string | null;
  submission_resolved_at: string | null;
  submission_withdrawn_at: string | null;
  review_decision: "approve" | "reject" | null;
  review_reason: string | null;
  review_created_at: string | null;
  submission_check_status: AuthorSubmission["checkStatus"];
  submission_check_error: string | null;
  submission_checked_at: string | null;
}

function toAuthorSubmission(row: AuthorProjectRow): AuthorSubmission | null {
  if (!row.submission_id || !row.submission_revision_id || !row.submission_status || !row.submission_submitted_at) {
    return null;
  }
  return {
    id: row.submission_id,
    revisionId: row.submission_revision_id,
    status: row.submission_status,
    gate: row.submission_gate,
    checkerRevision: row.submission_checker_revision,
    submittedAt: row.submission_submitted_at,
    resolvedAt: row.submission_resolved_at,
    withdrawnAt: row.submission_withdrawn_at,
    decision: row.review_decision,
    reason: row.review_reason,
    reviewedAt: row.review_created_at,
    checkStatus: row.submission_check_status,
    checkError: row.submission_check_error,
    checkedAt: row.submission_checked_at,
  };
}

export async function listAuthorProjects(db: D1Database, session: Session): Promise<AuthorProject[]> {
  const result = await db
    .prepare(`
    SELECT p.id, COALESCE(r.title, p.title) AS title,
      COALESCE(r.description, p.description) AS description,
      COALESCE(r.project_type, p.project_type) AS project_type,
      COALESCE(r.extension_type, p.extension_type) AS extension_type,
      p.visibility, p.published_at, p.updated_at, p.published_revision_id, p.downloads_count, p.likes_count,
      p.subscriptions_count, u.id AS author_id, COALESCE(u.global_name, u.username) AS author_name,
      u.avatar AS author_avatar, COALESCE(r.tags, p.search_tags) AS tags,
      COALESCE(r.worldbook_count, 0) AS worldbook_count, COALESCE(r.regex_count, 0) AS regex_count,
      r.schema_version, COALESCE(r.version_label, p.version_label) AS version_label,
      COALESCE(r.author_note, p.author_note) AS author_note,
      COALESCE(r.precautions, p.precautions) AS precautions,
      COALESCE(r.metadata_findings, p.metadata_findings) AS metadata_findings,
      COALESCE(r.cover_position_x, p.cover_position_x) AS cover_position_x,
      COALESCE(r.cover_position_y, p.cover_position_y) AS cover_position_y,
      COALESCE(r.cover_zoom, p.cover_zoom) AS cover_zoom, r.discord_thread_url,
      (SELECT a.r2_key FROM assets a WHERE a.revision_id = p.working_revision_id AND a.kind = 'cover' LIMIT 1) AS cover_key,
      COALESCE(
        (SELECT json_group_array(json_object('slot', g.slot, 'url', '/api/v1/assets/' || g.r2_key))
         FROM project_gallery g WHERE g.project_id = p.id),
        '[]'
      ) AS gallery,
      p.row_version, p.working_revision_id,
      s.id AS submission_id, s.revision_id AS submission_revision_id, s.status AS submission_status,
      s.client_gate AS submission_gate, s.client_checker_revision AS submission_checker_revision,
      s.submitted_at AS submission_submitted_at, s.resolved_at AS submission_resolved_at,
      s.withdrawn_at AS submission_withdrawn_at,
      s.check_status AS submission_check_status, s.check_error AS submission_check_error,
      s.checked_at AS submission_checked_at,
      rv.decision AS review_decision, rv.reason AS review_reason, rv.created_at AS review_created_at
    FROM projects p JOIN users u ON u.id = p.author_id
    LEFT JOIN project_revisions r ON r.id = p.working_revision_id
    LEFT JOIN submissions s ON s.id = (
      SELECT id FROM submissions WHERE project_id = p.id ORDER BY submitted_at DESC, id DESC LIMIT 1
    )
    LEFT JOIN reviews rv ON rv.submission_id = s.id
    WHERE p.author_id = ? AND p.deleted_at IS NULL
    ORDER BY p.updated_at DESC, p.id DESC
  `)
    .bind(session.userId)
    .all<AuthorProjectRow>();
  return result.results.map((row) => ({
    project: toSummary(row),
    rowVersion: row.row_version,
    workingRevisionId: row.working_revision_id,
    latestSubmission: toAuthorSubmission(row),
    authorNote: row.author_note ?? null,
    precautions: row.precautions ?? null,
    metadataFindings: row.metadata_findings ?? null,
  }));
}

export async function listAuthorSubmissions(
  db: D1Database,
  session: Session,
  projectId: string,
): Promise<AuthorSubmission[] | null> {
  const project = await db
    .prepare("SELECT id FROM projects WHERE id = ? AND author_id = ? AND deleted_at IS NULL")
    .bind(projectId, session.userId)
    .first<{ id: string }>();
  if (!project) return null;
  const result = await db
    .prepare(`
    SELECT s.id, s.revision_id, s.status, s.client_gate AS gate, s.client_checker_revision AS checker_revision, s.submitted_at, s.resolved_at,
      s.check_status, s.check_error, s.checked_at, s.withdrawn_at,
      rv.decision, rv.reason, rv.created_at
    FROM submissions s LEFT JOIN reviews rv ON rv.submission_id = s.id
    WHERE s.project_id = ?
    ORDER BY s.submitted_at DESC, s.id DESC
  `)
    .bind(projectId)
    .all<{
      id: string;
      revision_id: string;
      status: AuthorSubmission["status"];
      gate: string | null;
      checker_revision: string | null;
      submitted_at: string;
      resolved_at: string | null;
      check_status: AuthorSubmission["checkStatus"];
      check_error: string | null;
      checked_at: string | null;
      withdrawn_at: string | null;
      decision: "approve" | "reject" | null;
      reason: string | null;
      created_at: string | null;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    revisionId: row.revision_id,
    status: row.status,
    gate: row.gate,
    checkerRevision: row.checker_revision,
    submittedAt: row.submitted_at,
    resolvedAt: row.resolved_at,
    decision: row.decision,
    reason: row.reason,
    reviewedAt: row.created_at,
    checkStatus: row.check_status,
    checkError: row.check_error,
    checkedAt: row.checked_at,
    withdrawnAt: row.withdrawn_at,
  }));
}

export async function createProject(db: D1Database, session: Session, input: CreateProject): Promise<AuthoringProject> {
  const projectId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const tags = JSON.stringify(input.tags ?? []);
  const values: RevisionValues = {
    title: input.title,
    description: input.description ?? null,
    authorNote: input.authorNote ?? null,
    projectType: input.projectType ?? null,
    extensionType: input.extensionType ?? null,
    schemaVersion: input.schemaVersion ?? null,
    versionLabel: input.versionLabel ?? null,
    precautions: input.precautions ?? null,
    coverPositionX: input.coverPositionX ?? 50,
    coverPositionY: input.coverPositionY ?? 50,
    coverZoom: input.coverZoom ?? 1,
    discordThreadUrl: input.discordThreadUrl ?? null,
    tags: input.tags ?? [],
  };
  const meta = metadataSnapshot(values, session.userId, now);
  await db.batch([
    db
      .prepare(`INSERT INTO projects
      (id, author_id, title, description, author_note, project_type, extension_type, search_tags,
       visibility, working_revision_id, row_version, created_at, updated_at,
       version_label, precautions, cover_position_x, cover_position_y, cover_zoom,
       metadata_findings, metadata_checker_revision, metadata_checked_at, metadata_checked_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        projectId,
        session.userId,
        values.title,
        values.description,
        values.authorNote,
        values.projectType,
        values.extensionType,
        tags,
        revisionId,
        now,
        now,
        values.versionLabel,
        values.precautions,
        values.coverPositionX,
        values.coverPositionY,
        values.coverZoom,
        meta.findings,
        meta.revision,
        meta.checkedAt,
        meta.actorId,
      ),
    db
      .prepare(`INSERT INTO project_revisions
      (id, project_id, revision_no, title, description, author_note, project_type, extension_type,
       schema_version, version_label, precautions, cover_position_x, cover_position_y, cover_zoom,
       metadata_findings, metadata_checker_revision, metadata_checked_at, metadata_checked_by,
       discord_thread_url, tags, created_by, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        revisionId,
        projectId,
        values.title,
        values.description,
        values.authorNote,
        values.projectType,
        values.extensionType,
        values.schemaVersion,
        values.versionLabel,
        values.precautions,
        values.coverPositionX,
        values.coverPositionY,
        values.coverZoom,
        meta.findings,
        meta.revision,
        meta.checkedAt,
        meta.actorId,
        values.discordThreadUrl,
        tags,
        session.userId,
        now,
      ),
  ]);
  const project = await getProjectSummary(db, projectId);
  if (!project) throw new Error("Created project not found");
  return { project, rowVersion: 1, workingRevisionId: revisionId };
}

export async function softDeleteProject(
  db: D1Database,
  session: Session,
  projectId: string,
  expectedVersion?: number,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(`
    UPDATE projects
    SET deleted_at = ?, row_version = row_version + 1, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
      AND (author_id = ? OR ? = 'owner')
      AND (? IS NULL OR row_version = ?)
  `)
    .bind(now, now, projectId, session.userId, session.role, expectedVersion ?? null, expectedVersion ?? null)
    .run();
  if (result.meta.changes === 0) return false;
  await db
    .prepare(`
    INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
    VALUES (?, 'project.delete', 'project', ?, ?, ?, ?)
  `)
    .bind(crypto.randomUUID(), projectId, session.userId, JSON.stringify({ soft: true }), now)
    .run();
  return true;
}

export async function updateVisibility(
  db: D1Database,
  session: Session,
  projectId: string,
  expectedVersion: number,
  input: VisibilityUpdate,
): Promise<number | null> {
  const current = await getAuthoringProject(db, projectId, session);
  if (!current || current.row_version !== expectedVersion) return null;
  const result = await db
    .prepare(`UPDATE projects SET visibility = ?, row_version = row_version + 1, updated_at = ?
    WHERE id = ? AND row_version = ?`)
    .bind(input.visibility, new Date().toISOString(), projectId, expectedVersion)
    .run();
  return result.meta.changes === 0 ? null : expectedVersion + 1;
}
