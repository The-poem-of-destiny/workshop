import type { PatchProject, Session } from "@workshop/contracts";
import { inspectProjectMetadata, METADATA_CHECKER_REVISION, type MetadataInput } from "@workshop/domain";

export interface ProjectAccessRow {
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
  working_revision_frozen: number;
  row_version: number;
  version_label: string | null;
  precautions: string | null;
  cover_position_x: number;
  cover_position_y: number;
  cover_zoom: number;
}

export interface WorkingRevisionRow extends ProjectAccessRow {
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
  revision_worldbook_count: number | null;
  revision_regex_count: number | null;
}

export interface RevisionResult {
  rowVersion: number;
  revisionId: string;
}

export function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

export async function getAuthoringProject(
  db: D1Database,
  projectId: string,
  session: Session,
): Promise<ProjectAccessRow | null> {
  return db
    .prepare(`
    SELECT id, author_id, title, description, author_note, project_type, extension_type,
      search_tags, visibility, working_revision_id, published_revision_id, row_version,
      version_label, precautions, cover_position_x, cover_position_y, cover_zoom,
      EXISTS (SELECT 1 FROM submissions s WHERE s.revision_id = projects.working_revision_id) AS working_revision_frozen
    FROM projects
    WHERE id = ? AND deleted_at IS NULL AND (author_id = ? OR ? = 'owner')
  `)
    .bind(projectId, session.userId, session.role)
    .first<ProjectAccessRow>();
}

export async function getWorkingRevision(
  db: D1Database,
  projectId: string,
  session: Session,
): Promise<WorkingRevisionRow | null> {
  return db
    .prepare(`
    SELECT p.id, p.author_id, p.title, p.description, p.author_note, p.project_type, p.extension_type,
      p.search_tags, p.visibility, p.working_revision_id, p.published_revision_id, p.row_version,
      p.version_label, p.precautions, p.cover_position_x, p.cover_position_y, p.cover_zoom,
      r.revision_no, r.title AS revision_title, r.description AS revision_description,
      r.author_note AS revision_author_note, r.project_type AS revision_project_type,
      r.extension_type AS revision_extension_type, r.tags AS revision_tags,
      r.schema_version AS revision_schema_version, r.discord_thread_url AS revision_discord_thread_url,
      r.version_label AS revision_version_label, r.precautions AS revision_precautions,
      r.cover_position_x AS revision_cover_position_x, r.cover_position_y AS revision_cover_position_y,
      r.cover_zoom AS revision_cover_zoom,
      r.worldbook_count AS revision_worldbook_count, r.regex_count AS revision_regex_count,
      EXISTS (SELECT 1 FROM submissions s WHERE s.revision_id = p.working_revision_id) AS working_revision_frozen
    FROM projects p LEFT JOIN project_revisions r ON r.id = p.working_revision_id
    WHERE p.id = ? AND p.deleted_at IS NULL AND (p.author_id = ? OR ? = 'owner')
  `)
    .bind(projectId, session.userId, session.role)
    .first<WorkingRevisionRow>();
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

export function revisionValues(current: WorkingRevisionRow, patch: PatchProject): RevisionValues {
  return {
    title: patch.title ?? current.revision_title ?? current.title,
    description:
      patch.description !== undefined ? patch.description : (current.revision_description ?? current.description),
    authorNote:
      patch.authorNote !== undefined ? patch.authorNote : (current.revision_author_note ?? current.author_note),
    projectType:
      patch.projectType !== undefined ? patch.projectType : (current.revision_project_type ?? current.project_type),
    extensionType:
      patch.extensionType !== undefined
        ? patch.extensionType
        : (current.revision_extension_type ?? current.extension_type),
    schemaVersion: patch.schemaVersion !== undefined ? patch.schemaVersion : current.revision_schema_version,
    versionLabel:
      patch.versionLabel !== undefined ? patch.versionLabel : (current.revision_version_label ?? current.version_label),
    precautions:
      patch.precautions !== undefined ? patch.precautions : (current.revision_precautions ?? current.precautions),
    coverPositionX: patch.coverPositionX ?? current.revision_cover_position_x ?? current.cover_position_x,
    coverPositionY: patch.coverPositionY ?? current.revision_cover_position_y ?? current.cover_position_y,
    coverZoom: patch.coverZoom ?? current.revision_cover_zoom ?? current.cover_zoom,
    discordThreadUrl:
      patch.discordThreadUrl !== undefined ? patch.discordThreadUrl : current.revision_discord_thread_url,
    tags: patch.tags !== undefined ? patch.tags : parseTags(current.revision_tags || current.search_tags),
  };
}

export function metadataSnapshot(values: RevisionValues, actorId: string, now: string) {
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
