import type {
  AuthorProject,
  AuthorSubmission,
  CreateProject,
  ProjectSummary,
  Session,
  VisibilityUpdate,
} from "@workshop/contracts";
import {
  getAuthoringProject,
  parseIncludedTypes,
  parseRequirements,
  parseTags,
  type VersionValues,
} from "./authoring-model.js";

interface SummaryRow {
  id: string;
  title: string;
  description: string | null;
  project_type: ProjectSummary["projectType"];
  included_types: string;
  visibility: "public" | "private";
  published_at: string | null;
  updated_at: string;
  published_version_id: string | null;
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
  workingVersionId: string;
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
    projectType: row.project_type,
    includedTypes: parseIncludedTypes(row.included_types),
    tags: parseTags(row.tags),
    entries: { worldbook: row.worldbook_count, regex: row.regex_count },
    schemaVersion: row.schema_version,
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
    publishedVersionId: row.published_version_id,
  };
}

const summarySql = `
  SELECT p.id, r.title, r.description, r.project_type, r.included_types,
    p.visibility, p.published_at, p.updated_at, p.published_version_id, p.downloads_count, p.likes_count,
    p.subscriptions_count, u.id AS author_id, COALESCE(u.global_name, u.username) AS author_name,
    u.avatar AS author_avatar, r.tags,
    r.worldbook_count, r.regex_count,
    r.schema_version,
    r.discord_thread_url, r.version_label,
    r.cover_position_x, r.cover_position_y, r.cover_zoom,
    (SELECT a.r2_key FROM assets a WHERE a.version_id = p.working_version_id AND a.kind = 'cover' LIMIT 1) AS cover_key,
    COALESCE(
      (SELECT json_group_array(json_object('slot', CASE g.kind WHEN 'gallery_1' THEN 0 ELSE 1 END, 'url', '/api/v1/assets/' || g.r2_key))
       FROM assets g WHERE g.project_id = p.id AND g.version_id IS NULL AND g.kind IN ('gallery_1','gallery_2')),
      '[]'
    ) AS gallery
  FROM projects p JOIN users u ON u.id = p.author_id
  LEFT JOIN project_versions r ON r.id = p.working_version_id
  WHERE p.id = ? AND p.deleted_at IS NULL
`;

export async function getProjectSummary(db: D1Database, projectId: string): Promise<ProjectSummary | null> {
  const row = await db.prepare(summarySql).bind(projectId).first<SummaryRow>();
  return row ? toSummary(row) : null;
}

interface AuthorProjectRow extends SummaryRow {
  requirements: string | null;
  row_version: number;
  working_version_id: string | null;
  submission_id: string | null;
  submission_version_id: string | null;
  submission_status: AuthorSubmission["status"] | null;
  submission_gate: string | null;
  submission_checker_version: string | null;
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
  if (!row.submission_id || !row.submission_version_id || !row.submission_status || !row.submission_submitted_at) {
    return null;
  }
  return {
    id: row.submission_id,
    versionId: row.submission_version_id,
    status: row.submission_status,
    gate: row.submission_gate,
    checkerVersion: row.submission_checker_version,
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
    SELECT p.id, r.title, r.description, r.project_type, r.included_types,
      p.visibility, p.published_at, p.updated_at, p.published_version_id, p.downloads_count, p.likes_count,
      p.subscriptions_count, u.id AS author_id, COALESCE(u.global_name, u.username) AS author_name,
      u.avatar AS author_avatar, r.tags,
      r.worldbook_count, r.regex_count,
      r.schema_version, r.version_label, r.requirements,
      r.cover_position_x, r.cover_position_y, r.cover_zoom, r.discord_thread_url,
      (SELECT a.r2_key FROM assets a WHERE a.version_id = p.working_version_id AND a.kind = 'cover' LIMIT 1) AS cover_key,
      COALESCE(
        (SELECT json_group_array(json_object('slot', CASE g.kind WHEN 'gallery_1' THEN 0 ELSE 1 END, 'url', '/api/v1/assets/' || g.r2_key))
         FROM assets g WHERE g.project_id = p.id AND g.version_id IS NULL AND g.kind IN ('gallery_1','gallery_2')),
        '[]'
      ) AS gallery,
      p.row_version, p.working_version_id,
      s.id AS submission_id, s.version_id AS submission_version_id, s.status AS submission_status,
      ar.client_gate AS submission_gate, ar.client_checker_version AS submission_checker_version,
      s.submitted_at AS submission_submitted_at, s.resolved_at AS submission_resolved_at,
      s.withdrawn_at AS submission_withdrawn_at,
      ar.status AS submission_check_status, ar.error AS submission_check_error,
      ar.checked_at AS submission_checked_at,
      rv.decision AS review_decision, rv.reason AS review_reason, rv.created_at AS review_created_at
    FROM projects p JOIN users u ON u.id = p.author_id
    LEFT JOIN project_versions r ON r.id = p.working_version_id
    LEFT JOIN submissions s ON s.id = (
      SELECT id FROM submissions WHERE project_id = p.id ORDER BY submitted_at DESC, id DESC LIMIT 1
    )
    LEFT JOIN automated_reviews ar ON ar.submission_id = s.id
    LEFT JOIN manual_reviews rv ON rv.submission_id = s.id
    WHERE p.author_id = ? AND p.deleted_at IS NULL
    ORDER BY p.updated_at DESC, p.id DESC
  `)
    .bind(session.userId)
    .all<AuthorProjectRow>();
  return result.results.map((row) => ({
    project: toSummary(row),
    rowVersion: row.row_version,
    workingVersionId: row.working_version_id,
    latestSubmission: toAuthorSubmission(row),
    requirements: parseRequirements(row.requirements),
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
    SELECT s.id, s.version_id, s.status, ar.client_gate AS gate, ar.client_checker_version AS checker_version, s.submitted_at, s.resolved_at,
      ar.status AS check_status, ar.error AS check_error, ar.checked_at, s.withdrawn_at,
      rv.decision, rv.reason, rv.created_at
    FROM submissions s LEFT JOIN automated_reviews ar ON ar.submission_id = s.id
    LEFT JOIN manual_reviews rv ON rv.submission_id = s.id
    WHERE s.project_id = ?
    ORDER BY s.submitted_at DESC, s.id DESC
  `)
    .bind(projectId)
    .all<{
      id: string;
      version_id: string;
      status: AuthorSubmission["status"];
      gate: string | null;
      checker_version: string | null;
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
    versionId: row.version_id,
    status: row.status,
    gate: row.gate,
    checkerVersion: row.checker_version,
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
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const tags = JSON.stringify(input.tags);
  const values: VersionValues = {
    title: input.title,
    description: input.description ?? null,
    projectType: input.projectType,
    includedTypes: input.includedTypes,
    schemaVersion: input.schemaVersion ?? null,
    versionLabel: input.versionLabel ?? null,
    requirements: input.requirements == null ? null : JSON.stringify(input.requirements),
    coverPositionX: input.coverPositionX ?? 50,
    coverPositionY: input.coverPositionY ?? 50,
    coverZoom: input.coverZoom ?? 1,
    discordThreadUrl: input.discordThreadUrl ?? null,
    tags: input.tags,
  };
  await db.batch([
    db
      .prepare(`INSERT INTO projects
      (id, author_id, visibility, working_version_id, row_version, created_at, updated_at)
      VALUES (?, ?, 'private', ?, 1, ?, ?)`)
      .bind(projectId, session.userId, versionId, now, now),
    db
      .prepare(`INSERT INTO project_versions
      (id, project_id, version_no, title, description, project_type, included_types,
       schema_version, version_label, requirements, cover_position_x, cover_position_y, cover_zoom,
       discord_thread_url, tags, created_by, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        versionId,
        projectId,
        values.title,
        values.description,
        values.projectType,
        JSON.stringify(values.includedTypes),
        values.schemaVersion,
        values.versionLabel,
        values.requirements,
        values.coverPositionX,
        values.coverPositionY,
        values.coverZoom,
        values.discordThreadUrl,
        tags,
        session.userId,
        now,
      ),
  ]);
  const project = await getProjectSummary(db, projectId);
  if (!project) throw new Error("Created project not found");
  return { project, rowVersion: 1, workingVersionId: versionId };
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
