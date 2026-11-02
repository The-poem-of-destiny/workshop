import { type PatchProject, type Requirements, requirementsSchema, type Session } from "@workshop/contracts";

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
  working_version_id: string | null;
  published_version_id: string | null;
  working_version_frozen: number;
  row_version: number;
  version_label: string | null;
  requirements: string | null;
  cover_position_x: number;
  cover_position_y: number;
  cover_zoom: number;
}

export interface WorkingVersionRow extends ProjectAccessRow {
  version_no: number;
  version_title: string;
  version_description: string | null;
  version_author_note: string | null;
  version_project_type: string | null;
  version_extension_type: string | null;
  version_tags: string;
  version_schema_version: string | null;
  version_discord_thread_url: string | null;
  version_version_label: string | null;
  version_requirements: string | null;
  version_cover_position_x: number;
  version_cover_position_y: number;
  version_cover_zoom: number;
  version_worldbook_count: number | null;
  version_regex_count: number | null;
}

export interface VersionResult {
  rowVersion: number;
  versionId: string;
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
    SELECT p.id, p.author_id, r.title, r.description, r.author_note, r.project_type, r.extension_type,
      r.tags AS search_tags, p.visibility, p.working_version_id, p.published_version_id, p.row_version,
      r.version_label, r.requirements, r.cover_position_x, r.cover_position_y, r.cover_zoom,
      EXISTS (SELECT 1 FROM submissions s WHERE s.version_id = p.working_version_id) AS working_version_frozen
    FROM projects p JOIN project_versions r ON r.id = p.working_version_id
    WHERE p.id = ? AND p.deleted_at IS NULL AND (p.author_id = ? OR ? = 'owner')
  `)
    .bind(projectId, session.userId, session.role)
    .first<ProjectAccessRow>();
}

export async function getWorkingVersion(
  db: D1Database,
  projectId: string,
  session: Session,
): Promise<WorkingVersionRow | null> {
  return db
    .prepare(`
    SELECT p.id, p.author_id, r.title, r.description, r.author_note, r.project_type, r.extension_type,
      r.tags AS search_tags, p.visibility, p.working_version_id, p.published_version_id, p.row_version,
      r.version_label, r.requirements, r.cover_position_x, r.cover_position_y, r.cover_zoom,
      r.version_no, r.title AS version_title, r.description AS version_description,
      r.author_note AS version_author_note, r.project_type AS version_project_type,
      r.extension_type AS version_extension_type, r.tags AS version_tags,
      r.schema_version AS version_schema_version, r.discord_thread_url AS version_discord_thread_url,
      r.version_label AS version_version_label, r.requirements AS version_requirements,
      r.cover_position_x AS version_cover_position_x, r.cover_position_y AS version_cover_position_y,
      r.cover_zoom AS version_cover_zoom,
      r.worldbook_count AS version_worldbook_count, r.regex_count AS version_regex_count,
      EXISTS (SELECT 1 FROM submissions s WHERE s.version_id = p.working_version_id) AS working_version_frozen
    FROM projects p JOIN project_versions r ON r.id = p.working_version_id
    WHERE p.id = ? AND p.deleted_at IS NULL AND (p.author_id = ? OR ? = 'owner')
  `)
    .bind(projectId, session.userId, session.role)
    .first<WorkingVersionRow>();
}

export interface VersionValues {
  title: string;
  description: string | null;
  authorNote: string | null;
  projectType: string | null;
  extensionType: string | null;
  schemaVersion: string | null;
  versionLabel: string | null;
  requirements: string | null;
  coverPositionX: number;
  coverPositionY: number;
  coverZoom: number;
  discordThreadUrl: string | null;
  tags: string[];
}

export function versionValues(current: WorkingVersionRow, patch: PatchProject): VersionValues {
  return {
    title: patch.title ?? current.version_title,
    description: patch.description !== undefined ? patch.description : current.version_description,
    authorNote: patch.authorNote !== undefined ? patch.authorNote : current.version_author_note,
    projectType: patch.projectType !== undefined ? patch.projectType : current.version_project_type,
    extensionType: patch.extensionType !== undefined ? patch.extensionType : current.version_extension_type,
    schemaVersion: patch.schemaVersion !== undefined ? patch.schemaVersion : current.version_schema_version,
    versionLabel: patch.versionLabel !== undefined ? patch.versionLabel : current.version_version_label,
    requirements:
      patch.requirements !== undefined
        ? patch.requirements === null
          ? null
          : JSON.stringify(requirementsSchema.parse(patch.requirements))
        : current.version_requirements,
    coverPositionX: patch.coverPositionX ?? current.version_cover_position_x,
    coverPositionY: patch.coverPositionY ?? current.version_cover_position_y,
    coverZoom: patch.coverZoom ?? current.version_cover_zoom,
    discordThreadUrl:
      patch.discordThreadUrl !== undefined ? patch.discordThreadUrl : current.version_discord_thread_url,
    tags: patch.tags !== undefined ? patch.tags : parseTags(current.version_tags),
  };
}

export function parseRequirements(value: string | null): Requirements | null {
  return value === null ? null : requirementsSchema.parse(JSON.parse(value));
}
