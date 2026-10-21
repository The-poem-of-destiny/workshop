import type { AuthorProject, AuthorSubmission, ProjectSummary, Session } from "@workshop/contracts";
import type { CreateProject, PatchProject, SubmitProject, VisibilityUpdate } from "@workshop/contracts";
import { z } from "zod";
import {
  extractProjectEntries,
  getProjectEntryKey,
  inspectProjectMetadata,
  METADATA_CHECKER_REVISION,
  validateProjectContentPolicy,
  validateProjectContentText,
  type MetadataInput,
  type ProjectEntryKind,
} from "@workshop/domain";
import { REVIEW_CHECKER_REVISION } from "../content-checker.js";

interface ProjectAccessRow {
  id: string;
  author_id: string;
  title: string;
  description: string | null;
  author_note: string | null;
  project_type: string | null;
  extension_type: string | null;
  search_tags: string;
  visibility: "public" | "private";
  working_revision_id: string | null;
  published_revision_id: string | null;
  row_version: number;
  version_label: string | null;
  precautions: string | null;
  cover_position_x: number;
  cover_position_y: number;
  cover_zoom: number;
}

interface WorkingRevisionRow extends ProjectAccessRow {
  revision_no: number;
  revision_title: string;
  revision_description: string | null;
  revision_author_note: string | null;
  revision_project_type: string | null;
  revision_extension_type: string | null;
  revision_tags: string;
  revision_schema_version: string | null;
  revision_discord_thread_url: string | null;
  revision_version_label: string | null;
  revision_precautions: string | null;
  revision_cover_position_x: number;
  revision_cover_position_y: number;
  revision_cover_zoom: number;
}

interface SummaryRow {
  id: string;
  title: string;
  description: string | null;
  project_type: string | null;
  extension_type: string | null;
  visibility: "public" | "private";
  published_at: string | null;
  updated_at: string;
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
}

export interface AuthoringProject {
  project: ProjectSummary;
  rowVersion: number;
  workingRevisionId: string;
}

export interface RevisionResult {
  rowVersion: number;
  revisionId: string;
}

export interface UploadResult {
  kind: "worldbook" | "regex" | "cover";
  sha256: string;
  bytes: number;
  mime: string;
  r2Key: string;
}

function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function avatarUrl(userId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  return avatar.startsWith("https://") ? avatar : `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`;
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
    counts: { downloads: row.downloads_count, likes: row.likes_count, subscriptions: row.subscriptions_count },
    coverUrl: row.cover_key ? `/api/v1/assets/${row.cover_key}` : null,
    visibility: row.visibility,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

const summarySql = `
  SELECT p.id, COALESCE(r.title, p.title) AS title,
    COALESCE(r.description, p.description) AS description,
    COALESCE(r.project_type, p.project_type) AS project_type,
    COALESCE(r.extension_type, p.extension_type) AS extension_type,
    p.visibility, p.published_at, p.updated_at, p.downloads_count, p.likes_count,
    p.subscriptions_count, u.id AS author_id, COALESCE(u.global_name, u.username) AS author_name,
    u.avatar AS author_avatar, COALESCE(r.tags, p.search_tags) AS tags,
    COALESCE(r.worldbook_count, 0) AS worldbook_count, COALESCE(r.regex_count, 0) AS regex_count,
    r.schema_version, COALESCE(r.author_note, p.author_note) AS author_note,
    r.discord_thread_url, COALESCE(r.version_label, p.version_label) AS version_label,
    COALESCE(r.cover_position_x, p.cover_position_x) AS cover_position_x,
    COALESCE(r.cover_position_y, p.cover_position_y) AS cover_position_y,
    COALESCE(r.cover_zoom, p.cover_zoom) AS cover_zoom,
    (SELECT a.r2_key FROM assets a WHERE a.revision_id = p.working_revision_id AND a.kind = 'cover' LIMIT 1) AS cover_key
  FROM projects p JOIN users u ON u.id = p.author_id
  LEFT JOIN project_revisions r ON r.id = p.working_revision_id
  WHERE p.id = ? AND p.deleted_at IS NULL
`;

export async function getAuthoringProject(
  db: D1Database,
  projectId: string,
  session: Session,
): Promise<ProjectAccessRow | null> {
  return db.prepare(`
    SELECT id, author_id, title, description, author_note, project_type, extension_type,
      search_tags, visibility, working_revision_id, published_revision_id, row_version,
      version_label, precautions, cover_position_x, cover_position_y, cover_zoom
    FROM projects
    WHERE id = ? AND deleted_at IS NULL AND (author_id = ? OR ? = 'owner')
  `).bind(projectId, session.userId, session.role).first<ProjectAccessRow>();
}

async function getWorkingRevision(db: D1Database, projectId: string, session: Session): Promise<WorkingRevisionRow | null> {
  return db.prepare(`
    SELECT p.id, p.author_id, p.title, p.description, p.author_note, p.project_type, p.extension_type,
      p.search_tags, p.visibility, p.working_revision_id, p.published_revision_id, p.row_version,
      p.version_label, p.precautions, p.cover_position_x, p.cover_position_y, p.cover_zoom,
      r.revision_no, r.title AS revision_title, r.description AS revision_description,
      r.author_note AS revision_author_note, r.project_type AS revision_project_type,
      r.extension_type AS revision_extension_type, r.tags AS revision_tags,
      r.schema_version AS revision_schema_version, r.discord_thread_url AS revision_discord_thread_url,
      r.version_label AS revision_version_label, r.precautions AS revision_precautions,
      r.cover_position_x AS revision_cover_position_x, r.cover_position_y AS revision_cover_position_y,
      r.cover_zoom AS revision_cover_zoom
    FROM projects p LEFT JOIN project_revisions r ON r.id = p.working_revision_id
    WHERE p.id = ? AND p.deleted_at IS NULL AND (p.author_id = ? OR ? = 'owner')
  `).bind(projectId, session.userId, session.role).first<WorkingRevisionRow>();
}

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
    decision: row.review_decision,
    reason: row.review_reason,
    reviewedAt: row.review_created_at,
    checkStatus: row.submission_check_status,
    checkError: row.submission_check_error,
    checkedAt: row.submission_checked_at,
  };
}

export async function listAuthorProjects(db: D1Database, session: Session): Promise<AuthorProject[]> {
  const result = await db.prepare(`
    SELECT p.id, COALESCE(r.title, p.title) AS title,
      COALESCE(r.description, p.description) AS description,
      COALESCE(r.project_type, p.project_type) AS project_type,
      COALESCE(r.extension_type, p.extension_type) AS extension_type,
      p.visibility, p.published_at, p.updated_at, p.downloads_count, p.likes_count,
      p.subscriptions_count, u.id AS author_id, COALESCE(u.global_name, u.username) AS author_name,
      u.avatar AS author_avatar, COALESCE(r.tags, p.search_tags) AS tags,
      COALESCE(r.worldbook_count, 0) AS worldbook_count, COALESCE(r.regex_count, 0) AS regex_count,
      r.schema_version, COALESCE(r.version_label, p.version_label) AS version_label,
      COALESCE(r.author_note, p.author_note) AS author_note,
      COALESCE(r.precautions, p.precautions) AS precautions,
      COALESCE(r.metadata_findings, p.metadata_findings) AS metadata_findings,
      COALESCE(r.cover_position_x, p.cover_position_x) AS cover_position_x,
      COALESCE(r.cover_position_y, p.cover_position_y) AS cover_position_y,
      COALESCE(r.cover_zoom, p.cover_zoom) AS cover_zoom,
      (SELECT a.r2_key FROM assets a WHERE a.revision_id = p.working_revision_id AND a.kind = 'cover' LIMIT 1) AS cover_key,
      p.row_version, p.working_revision_id,
      s.id AS submission_id, s.revision_id AS submission_revision_id, s.status AS submission_status,
      s.gate AS submission_gate, s.checker_revision AS submission_checker_revision,
      s.submitted_at AS submission_submitted_at, s.resolved_at AS submission_resolved_at,
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
  `).bind(session.userId).all<AuthorProjectRow>();
  return result.results.map(row => ({
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
  const project = await db.prepare("SELECT id FROM projects WHERE id = ? AND author_id = ? AND deleted_at IS NULL")
    .bind(projectId, session.userId).first<{ id: string }>();
  if (!project) return null;
  const result = await db.prepare(`
    SELECT s.id, s.revision_id, s.status, s.gate, s.checker_revision, s.submitted_at, s.resolved_at,
      s.check_status, s.check_error, s.checked_at,
      rv.decision, rv.reason, rv.created_at
    FROM submissions s LEFT JOIN reviews rv ON rv.submission_id = s.id
    WHERE s.project_id = ?
    ORDER BY s.submitted_at DESC, s.id DESC
  `).bind(projectId).all<{
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
    decision: "approve" | "reject" | null;
    reason: string | null;
    created_at: string | null;
  }>();
  return result.results.map(row => ({
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
    db.prepare(`INSERT INTO projects
      (id, author_id, title, description, author_note, project_type, extension_type, search_tags,
       visibility, working_revision_id, row_version, created_at, updated_at,
       version_label, precautions, cover_position_x, cover_position_y, cover_zoom,
       metadata_findings, metadata_checker_revision, metadata_checked_at, metadata_checked_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(projectId, session.userId, values.title, values.description, values.authorNote,
        values.projectType, values.extensionType, tags, revisionId, now, now,
        values.versionLabel, values.precautions, values.coverPositionX, values.coverPositionY, values.coverZoom,
        meta.findings, meta.revision, meta.checkedAt, meta.actorId),
    db.prepare(`INSERT INTO project_revisions
      (id, project_id, revision_no, title, description, author_note, project_type, extension_type,
       schema_version, version_label, precautions, cover_position_x, cover_position_y, cover_zoom,
       metadata_findings, metadata_checker_revision, metadata_checked_at, metadata_checked_by,
       discord_thread_url, tags, created_by, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(revisionId, projectId, values.title, values.description, values.authorNote,
        values.projectType, values.extensionType, values.schemaVersion, values.versionLabel,
        values.precautions, values.coverPositionX, values.coverPositionY, values.coverZoom,
        meta.findings, meta.revision, meta.checkedAt, meta.actorId,
        values.discordThreadUrl, tags, session.userId, now),
  ]);
  const project = await getProjectSummary(db, projectId);
  if (!project) throw new Error("Created project not found");
  return { project, rowVersion: 1, workingRevisionId: revisionId };
}


export async function patchProject(
  db: D1Database,
  session: Session,
  projectId: string,
  expectedVersion: number,
  input: PatchProject,
): Promise<RevisionResult | null> {
  const current = await getWorkingRevision(db, projectId, session);
  if (!current || current.row_version !== expectedVersion || !current.working_revision_id) return null;
  const values = revisionValues(current, input);
  const now = new Date().toISOString();
  const meta = metadataSnapshot(values, session.userId, now);
  const tags = JSON.stringify(values.tags);
  const preservePublished = current.published_revision_id !== null
    && current.published_revision_id !== current.working_revision_id;
  const projectUpdate = preservePublished
    ? db.prepare(`UPDATE projects
      SET row_version = row_version + 1, updated_at = ?
      WHERE id = ? AND row_version = ? AND working_revision_id = ?`)
      .bind(now, projectId, expectedVersion, current.working_revision_id)
    : db.prepare(`UPDATE projects
      SET title = ?, description = ?, author_note = ?, project_type = ?, extension_type = ?,
          search_tags = ?, version_label = ?, precautions = ?, cover_position_x = ?,
          cover_position_y = ?, cover_zoom = ?, metadata_findings = ?,
          metadata_checker_revision = ?, metadata_checked_at = ?, metadata_checked_by = ?,
          row_version = row_version + 1, updated_at = ?
      WHERE id = ? AND row_version = ? AND working_revision_id = ?`)
      .bind(
        values.title, values.description, values.authorNote, values.projectType, values.extensionType,
        tags, values.versionLabel, values.precautions, values.coverPositionX, values.coverPositionY,
        values.coverZoom, meta.findings, meta.revision, meta.checkedAt, meta.actorId, now,
        projectId, expectedVersion, current.working_revision_id,
      );
  const [updated] = await db.batch([
    projectUpdate,
    db.prepare(`UPDATE project_revisions
      SET title = ?, description = ?, author_note = ?, project_type = ?, extension_type = ?,
          tags = ?, schema_version = COALESCE(schema_version, ?), version_label = ?, precautions = ?,
          cover_position_x = ?, cover_position_y = ?, cover_zoom = ?, metadata_findings = ?,
          metadata_checker_revision = ?, metadata_checked_at = ?, metadata_checked_by = ?,
          discord_thread_url = ?
      WHERE id = ?`)
      .bind(
        values.title, values.description, values.authorNote, values.projectType, values.extensionType,
        tags, values.schemaVersion, values.versionLabel, values.precautions, values.coverPositionX,
        values.coverPositionY, values.coverZoom, meta.findings, meta.revision, meta.checkedAt,
        meta.actorId, values.discordThreadUrl, current.working_revision_id,
      ),
    db.prepare(`INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      SELECT ?, 'project.patch', 'project', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND row_version = ?)`)
      .bind(
        crypto.randomUUID(), projectId, session.userId,
        JSON.stringify({ fields: Object.keys(input), rowVersion: expectedVersion + 1 }),
        now, projectId, expectedVersion + 1,
      ),
  ]);
  if (!updated || updated.meta.changes === 0) return null;
  return { rowVersion: expectedVersion + 1, revisionId: current.working_revision_id };
}

export interface RevisionValues {
  title: string;
  description: string | null;
  authorNote: string | null;
  projectType: string | null;
  extensionType: string | null;
  schemaVersion: string | null;
  versionLabel: string | null;
  precautions: string | null;
  coverPositionX: number;
  coverPositionY: number;
  coverZoom: number;
  discordThreadUrl: string | null;
  tags: string[];
}

function revisionValues(current: WorkingRevisionRow, patch: PatchProject): RevisionValues {
  return {
    title: patch.title ?? current.revision_title ?? current.title,
    description: patch.description !== undefined ? patch.description : current.revision_description ?? current.description,
    authorNote: patch.authorNote !== undefined ? patch.authorNote : current.revision_author_note ?? current.author_note,
    projectType: patch.projectType !== undefined ? patch.projectType : current.revision_project_type ?? current.project_type,
    extensionType: patch.extensionType !== undefined ? patch.extensionType : current.revision_extension_type ?? current.extension_type,
    schemaVersion: patch.schemaVersion !== undefined ? patch.schemaVersion : current.revision_schema_version,
    versionLabel: patch.versionLabel !== undefined ? patch.versionLabel : current.revision_version_label ?? current.version_label,
    precautions: patch.precautions !== undefined ? patch.precautions : current.revision_precautions ?? current.precautions,
    coverPositionX: patch.coverPositionX ?? current.revision_cover_position_x ?? current.cover_position_x,
    coverPositionY: patch.coverPositionY ?? current.revision_cover_position_y ?? current.cover_position_y,
    coverZoom: patch.coverZoom ?? current.revision_cover_zoom ?? current.cover_zoom,
    discordThreadUrl: patch.discordThreadUrl !== undefined ? patch.discordThreadUrl : current.revision_discord_thread_url,
    tags: patch.tags !== undefined ? patch.tags : parseTags(current.revision_tags || current.search_tags),
  };
}

function metadataSnapshot(values: RevisionValues, actorId: string, now: string) {
  const input: MetadataInput = {
    title: values.title,
    description: values.description,
    authorNote: values.authorNote,
    precautions: values.precautions,
    versionLabel: values.versionLabel,
    tags: values.tags,
    coverPositionX: values.coverPositionX,
    coverPositionY: values.coverPositionY,
    coverZoom: values.coverZoom,
  };
  const inspection = inspectProjectMetadata(input);
  return {
    gate: inspection.gate,
    findings: JSON.stringify(inspection.findings),
    revision: METADATA_CHECKER_REVISION,
    checkedAt: now,
    actorId,
  };
}

async function addRevision(
  db: D1Database,
  session: Session,
  current: WorkingRevisionRow,
  expectedVersion: number,
  values: RevisionValues,
): Promise<RevisionResult | null> {
  const revisionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const nextNo = current.revision_no + 1;
  const tags = JSON.stringify(values.tags);
  const meta = metadataSnapshot(values, session.userId, now);
  const [updated] = await db.batch([
    db.prepare(`UPDATE projects SET working_revision_id = ?, row_version = row_version + 1, updated_at = ?
      WHERE id = ? AND row_version = ? AND working_revision_id = ?`)
      .bind(revisionId, now, current.id, expectedVersion, current.working_revision_id),
    db.prepare(`INSERT INTO project_revisions
      (id, project_id, revision_no, title, description, author_note, project_type, extension_type,
       schema_version, version_label, precautions, cover_position_x, cover_position_y, cover_zoom,
       metadata_findings, metadata_checker_revision, metadata_checked_at, metadata_checked_by,
       discord_thread_url, tags, created_by, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM projects
        WHERE id = ? AND row_version = ? AND working_revision_id = ?
      )`)
      .bind(
        revisionId, current.id, nextNo, values.title, values.description, values.authorNote,
        values.projectType, values.extensionType, values.schemaVersion, values.versionLabel,
        values.precautions, values.coverPositionX, values.coverPositionY, values.coverZoom,
        meta.findings, meta.revision, meta.checkedAt, meta.actorId, values.discordThreadUrl,
        tags, session.userId, now, current.id, expectedVersion + 1, revisionId,
      ),
  ]);
  if (!updated || updated.meta.changes === 0) return null;
  return { rowVersion: expectedVersion + 1, revisionId };
}

export async function createRevision(
  db: D1Database,
  session: Session,
  projectId: string,
  expectedVersion: number,
  input: PatchProject,
): Promise<RevisionResult | null> {
  const current = await getWorkingRevision(db, projectId, session);
  if (!current || current.row_version !== expectedVersion) return null;
  return addRevision(db, session, current, expectedVersion, revisionValues(current, input));
}
function removeSerializedEntry(
  raw: unknown,
  kind: ProjectEntryKind,
  entryKey: string,
): { text: string; entryCount: number } | null {
  const array = z.array(z.record(z.string(), z.unknown())).safeParse(raw);
  if (array.success) {
    const next = array.data.filter((value, index) => getProjectEntryKey(kind, value, index) !== entryKey);
    if (next.length === array.data.length) return null;
    return { text: JSON.stringify(next), entryCount: extractProjectEntries(next, kind).length };
  }

  const container = z.object({
    entries: z.union([
      z.array(z.record(z.string(), z.unknown())),
      z.record(z.string(), z.record(z.string(), z.unknown())),
    ]),
  }).passthrough().safeParse(raw);
  if (container.success) {
    if (Array.isArray(container.data.entries)) {
      const next = container.data.entries.filter((value, index) => getProjectEntryKey(kind, value, index) !== entryKey);
      if (next.length === container.data.entries.length) return null;
      return {
        text: JSON.stringify({ ...container.data, entries: next }),
        entryCount: extractProjectEntries(next, kind).length,
      };
    }
    const next = { ...container.data.entries };
    let removed = false;
    for (const [key, value] of Object.entries(next)) {
      if (getProjectEntryKey(kind, value, 0, key) !== entryKey) continue;
      delete next[key];
      removed = true;
    }
    if (!removed) return null;
    return {
      text: JSON.stringify({ ...container.data, entries: next }),
      entryCount: extractProjectEntries(next, kind).length,
    };
  }

  const single = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!single.success || kind !== "regex" || getProjectEntryKey(kind, single.data, 0) !== entryKey) return null;
  return { text: "[]", entryCount: 0 };
}

export async function deleteProjectEntry(
  db: D1Database,
  r2: R2Bucket,
  session: Session,
  projectId: string,
  revisionId: string,
  kind: ProjectEntryKind,
  entryKey: string,
  expectedVersion: number,
): Promise<{ rowVersion: number; revisionId: string; entryCount: number } | null> {
  const current = await getWorkingRevision(db, projectId, session);
  if (!current || current.row_version !== expectedVersion || current.working_revision_id !== revisionId) return null;
  const submitted = await db.prepare("SELECT 1 AS present FROM submissions WHERE revision_id = ?")
    .bind(revisionId).first<{ present: number }>();
  if (submitted) return null;
  const asset = await db.prepare(`
    SELECT r2_key, mime FROM assets WHERE revision_id = ? AND kind = ?
  `).bind(revisionId, kind).first<{ r2_key: string; mime: string }>();
  if (!asset) return null;
  const object = await r2.get(asset.r2_key);
  if (!object) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await object.text());
  } catch {
    return null;
  }
  const removed = removeSerializedEntry(raw, kind, entryKey);
  if (!removed) return null;
  if (removed.entryCount === 0) {
    const otherKind = kind === "worldbook" ? "regex" : "worldbook";
    const other = await db.prepare(
      "SELECT 1 AS present FROM assets WHERE revision_id = ? AND kind = ? LIMIT 1",
    ).bind(revisionId, otherKind).first<{ present: number }>();
    const policy = validateProjectContentPolicy(
      { projectType: current.project_type, tags: parseTags(current.search_tags) },
      {
        worldbook: kind === "worldbook" ? false : Boolean(other?.present),
        regex: kind === "regex" ? false : Boolean(other?.present),
      },
    );
    if (!policy.valid) return null;
  }
  const revision = await addRevision(db, session, current, expectedVersion, revisionValues(current, {}));
  if (!revision) return null;
  const body = new TextEncoder().encode(removed.text).buffer;
  await upsertAsset(db, r2, projectId, revision.revisionId, kind, body, asset.mime, removed.entryCount);
  if (!await copyRetainedAssets(db, r2, projectId, revisionId, revision.revisionId, kind)) return null;
  return { ...revision, entryCount: removed.entryCount };
}

export async function softDeleteProject(
  db: D1Database,
  session: Session,
  projectId: string,
  expectedVersion?: number,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE projects
    SET deleted_at = ?, row_version = row_version + 1, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
      AND (author_id = ? OR ? = 'owner')
      AND (? IS NULL OR row_version = ?)
  `).bind(now, now, projectId, session.userId, session.role, expectedVersion ?? null, expectedVersion ?? null).run();
  if (result.meta.changes === 0) return false;
  await db.prepare(`
    INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
    VALUES (?, 'project.delete', 'project', ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), projectId, session.userId, JSON.stringify({ soft: true }), now).run();
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
  const result = await db.prepare(`UPDATE projects SET visibility = ?, row_version = row_version + 1, updated_at = ?
    WHERE id = ? AND row_version = ?`).bind(input.visibility, new Date().toISOString(), projectId, expectedVersion).run();
  return result.meta.changes === 0 ? null : expectedVersion + 1;
}

export interface RevisionAccess {
  id: string;
  project_id: string;
  revision_no: number;
  working_revision_id: string | null;
}

export async function getRevisionForProject(
  db: D1Database,
  projectId: string,
  revisionId: string,
  session: Session,
): Promise<RevisionAccess | null> {
  return db.prepare(`SELECT r.id, r.project_id, r.revision_no, p.working_revision_id
    FROM project_revisions r JOIN projects p ON p.id = r.project_id
    WHERE r.id = ? AND r.project_id = ? AND p.deleted_at IS NULL
      AND p.working_revision_id = r.id
      AND (p.published_revision_id IS NULL OR p.published_revision_id <> r.id)
      AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.revision_id = r.id)
      AND (p.author_id = ? OR ? = 'owner')`).bind(revisionId, projectId, session.userId, session.role).first<RevisionAccess>();
}

interface RetainedAssetRow {
  kind: string;
  r2_key: string;
  sha256: string;
  bytes: number;
  mime: string;
}

function assetKey(projectId: string, revisionId: string, kind: string, sha256: string, mime: string): string {
  const ext = extensionForMime(mime);
  return kind === "cover"
    ? `covers/${projectId}/${revisionId}-${sha256}.${ext}`
    : `projects/${projectId}/revisions/${revisionId}/${kind}-${sha256}.${ext}`;
}

async function copyRetainedAssets(
  db: D1Database,
  r2: R2Bucket,
  projectId: string,
  fromRevisionId: string,
  toRevisionId: string,
  excludedKind: string,
): Promise<boolean> {
  const rows = await db.prepare(`
    SELECT kind, r2_key, sha256, bytes, mime FROM assets
    WHERE revision_id = ? AND kind <> ?
  `).bind(fromRevisionId, excludedKind).all<RetainedAssetRow>();
  if (rows.results.length === 0) return true;

  const statements: D1PreparedStatement[] = [];
  for (const asset of rows.results) {
    const object = await r2.get(asset.r2_key);
    if (!object) throw new Error(`Retained asset is missing: ${asset.r2_key}`);
    const key = assetKey(projectId, toRevisionId, asset.kind, asset.sha256, asset.mime);
    await r2.put(key, object.body, { httpMetadata: { contentType: asset.mime } });
    statements.push(db.prepare(`INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND working_revision_id = ?)
        AND NOT EXISTS (SELECT 1 FROM submissions WHERE revision_id = ?)`)
      .bind(
        crypto.randomUUID(), projectId, toRevisionId, asset.kind, key, asset.sha256, asset.bytes, asset.mime,
        projectId, toRevisionId, toRevisionId,
      ));
  }
  const results = await db.batch(statements);
  return results.every(result => result.meta.changes === 1);
}

export async function upsertAsset(
  db: D1Database,
  r2: R2Bucket,
  projectId: string,
  revisionId: string,
  kind: UploadResult["kind"],
  body: ArrayBuffer,
  mime: string,
  entryCount?: number,
): Promise<UploadResult | null> {
  const hash = await crypto.subtle.digest("SHA-256", body);
  const sha256 = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const r2Key = assetKey(projectId, revisionId, kind, sha256, mime);
  // Content-addressed keys make a pre-insert put safe: a frozen revision never
  // points at the new key, and identical bytes reuse the same object.
  await r2.put(r2Key, body, { httpMetadata: { contentType: mime } });

  const statements = [
    db.prepare(`INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND working_revision_id = ?)
        AND NOT EXISTS (SELECT 1 FROM submissions WHERE revision_id = ?)
      ON CONFLICT(revision_id, kind) DO UPDATE SET r2_key = excluded.r2_key, sha256 = excluded.sha256,
        bytes = excluded.bytes, mime = excluded.mime, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      .bind(
        crypto.randomUUID(), projectId, revisionId, kind, r2Key, sha256, body.byteLength, mime,
        projectId, revisionId, revisionId,
      ),
  ];

  if (kind !== "cover") {
    if (!Number.isInteger(entryCount) || (entryCount ?? 0) < 0) {
      throw new Error("Validated entry count is required for content uploads");
    }
    const column = kind === "worldbook" ? "worldbook_count" : "regex_count";
    statements.push(db.prepare(`UPDATE project_revisions SET ${column} = ?
      WHERE id = ?
        AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND working_revision_id = ?)
        AND NOT EXISTS (SELECT 1 FROM submissions WHERE revision_id = ?)`)
      .bind(entryCount, revisionId, projectId, revisionId, revisionId));
  }

  const [inserted] = await db.batch(statements);
  if (!inserted || inserted.meta.changes === 0) return null;
  return { kind, sha256, bytes: body.byteLength, mime, r2Key };
}

function extensionForMime(mime: string): string {
  const known: Record<string, string> = {
    "application/json": "json", "application/zip": "zip", "text/plain": "txt",
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  };
  return known[mime] ?? "bin";
}

export interface PrevalidatedContent {
  presence: Record<ProjectEntryKind, boolean>;
  counts: Record<ProjectEntryKind, number>;
  hashes: Partial<Record<ProjectEntryKind, string>>;
  conflict: string | null;
  error: string | null;
}

export type SubmitRevisionResult =
  | { ok: true; submissionId: string; checkStatus: "queued" | "needs_human" }
  | { ok: false; code: "not_found" | "invalid_content" | "conflict"; message: string };

interface RevisionAssetRow {
  kind: string;
  r2_key: string;
  sha256: string;
}

async function baselineEntryConflict(db: D1Database, text: string): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const refs = extractProjectEntries(parsed, "worldbook");
  if (refs.length === 0) return null;
  const fingerprints = await Promise.all(refs.map(async ref => {
    const entry = ref.entry;
    const rawName = entry.comment ?? entry.name;
    const name = String(rawName ?? "").replace(/\r\n/g, "\n").trim();
    const content = String(entry.content ?? "").replace(/\r\n/g, "\n").trim();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify({ name, content })),
    );
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }));
  const match = await db.prepare(`
    SELECT display_name FROM reference_items
    WHERE kind = 'worldbook' AND exact_hash IN (${fingerprints.map(() => "?").join(", ")})
    LIMIT 1
  `).bind(...fingerprints).first<{ display_name: string }>();
  return match?.display_name ?? null;
}

export async function submitRevision(
  db: D1Database,
  r2: R2Bucket,
  session: Session,
  projectId: string,
  revisionId: string,
  input: SubmitProject,
  prevalidated?: PrevalidatedContent,
): Promise<SubmitRevisionResult> {
  const current = await getWorkingRevision(db, projectId, session);
  if (!current || current.working_revision_id !== revisionId) {
    return { ok: false, code: "not_found", message: "Working revision not found" };
  }

  const previous = await db.prepare(`
    SELECT id, status FROM submissions
    WHERE project_id = ? AND status IN ('pending', 'checking')
  `).bind(projectId).all<{ id: string; status: string }>();

  // Freeze first: the pending submission makes the upload guard reject any
  // later asset write, so the asset snapshot read below cannot change.
  const submissionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const clientGate = input.gate ?? "missing";
  const checkStatus = clientGate === "pass" || clientGate === "warn" ? "queued" : "needs_human";
  const submissionStatus = checkStatus === "queued" ? "checking" : "pending";
  await db.batch([
    db.prepare("UPDATE submissions SET status = 'superseded', resolved_at = ? WHERE project_id = ? AND status IN ('pending', 'checking')")
      .bind(now, projectId),
    db.prepare(`INSERT INTO submissions
      (id, project_id, revision_id, status, gate, checker_revision, submitted_by, submitted_at,
       client_gate, client_checker_revision, client_warning_count, client_acknowledged_at, check_status,
       review_checker_revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        submissionId, projectId, revisionId, submissionStatus, clientGate, input.checkerRevision ?? null,
        session.userId, now, clientGate, input.checkerRevision ?? null, input.warningCount,
        input.acknowledged ? now : null, checkStatus, REVIEW_CHECKER_REVISION,
      ),
  ]);

  const assets = await db.prepare("SELECT kind, r2_key, sha256 FROM assets WHERE revision_id = ? ORDER BY kind")
    .bind(revisionId).all<RevisionAssetRow>();

  const presence: Record<ProjectEntryKind, boolean> = { worldbook: false, regex: false };
  const counts: Record<ProjectEntryKind, number> = { worldbook: 0, regex: 0 };
  let validationError: string | null = null;

  if (prevalidated) {
    for (const asset of assets.results) {
      if (asset.kind !== "worldbook" && asset.kind !== "regex") continue;
      if (prevalidated.hashes[asset.kind] !== asset.sha256) {
        validationError = "内容在检查期间发生变化，请重新提交";
        break;
      }
    }
    for (const kind of ["worldbook", "regex"] as const) {
      const present = assets.results.some(asset => asset.kind === kind);
      if (!validationError && present !== prevalidated.presence[kind]) {
        validationError = "内容在检查期间发生变化，请重新提交";
      }
    }
    presence.worldbook = prevalidated.presence.worldbook;
    presence.regex = prevalidated.presence.regex;
    counts.worldbook = prevalidated.counts.worldbook;
    counts.regex = prevalidated.counts.regex;
    if (prevalidated.error) validationError = prevalidated.error;
    if (prevalidated.conflict) {
      validationError = `世界书条目与官方基线「${prevalidated.conflict}」完全相同，请基于基线修改后再提交`;
    }
  } else {
    try {
      for (const asset of assets.results) {
        if (asset.kind !== "worldbook" && asset.kind !== "regex") continue;
        const kind = asset.kind as ProjectEntryKind;
        const object = await r2.get(asset.r2_key);
        if (!object) {
          validationError = "项目文件缺失，请重新上传";
          break;
        }
        const text = await object.text();
        const validation = validateProjectContentText(text, kind);
        if (!validation.valid) {
          validationError = validation.error;
          break;
        }
        presence[kind] = true;
        counts[kind] = validation.entryCount;
        if (kind === "worldbook") {
          const conflict = await baselineEntryConflict(db, text);
          if (conflict) {
            validationError = `世界书条目与官方基线「${conflict}」完全相同，请基于基线修改后再提交`;
            break;
          }
        }
      }
    } catch (error) {
      validationError = error instanceof Error ? `项目文件读取失败：${error.message}` : "项目文件读取失败";
    }
  }

  if (!validationError) {
    const policy = validateProjectContentPolicy(
      {
        projectType: current.revision_project_type ?? current.project_type,
        tags: parseTags(current.revision_tags || current.search_tags),
      },
      presence,
    );
    if (!policy.valid) validationError = policy.error;
  }

  if (validationError) {
    const restore = [
      db.prepare("DELETE FROM submissions WHERE id = ? AND status IN ('pending', 'checking')").bind(submissionId),
      ...previous.results.map(item =>
        db.prepare("UPDATE submissions SET status = ?, resolved_at = NULL WHERE id = ? AND status = 'superseded'")
          .bind(item.status, item.id),
      ),
    ];
    await db.batch(restore);
    return { ok: false, code: "invalid_content", message: validationError };
  }

  const manifest = assets.results.map(asset => `${asset.kind}:${asset.sha256}`).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(manifest));
  const manifestHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  await db.prepare(`UPDATE project_revisions
    SET manifest_hash = ?, worldbook_count = ?, regex_count = ?
    WHERE id = ?`).bind(manifestHash, counts.worldbook, counts.regex, revisionId).run();
  return { ok: true, submissionId, checkStatus };
}
