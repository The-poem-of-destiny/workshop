import type { PatchProject, Session } from "@workshop/contracts";
import {
  getWorkingVersion,
  type VersionResult,
  type VersionValues,
  versionValues,
  type WorkingVersionRow,
} from "./authoring-model.js";

export async function patchProject(
  db: D1Database,
  session: Session,
  projectId: string,
  expectedVersion: number,
  input: PatchProject,
): Promise<VersionResult | null> {
  const current = await getWorkingVersion(db, projectId, session);
  if (!current || current.row_version !== expectedVersion || !current.working_version_id) return null;
  if (current.working_version_frozen) return null;
  const values = versionValues(current, input);
  const now = new Date().toISOString();
  const tags = JSON.stringify(values.tags);
  const projectUpdate = db
    .prepare(`UPDATE projects SET row_version = row_version + 1,
      updated_at = CASE WHEN published_version_id IS NULL OR published_version_id = working_version_id THEN ? ELSE updated_at END
      WHERE id = ? AND row_version = ? AND working_version_id = ? AND deleted_at IS NULL
        AND (published_version_id IS NULL OR published_version_id <> working_version_id)
        AND NOT EXISTS (SELECT 1 FROM submissions WHERE version_id = projects.working_version_id)`)
    .bind(now, projectId, expectedVersion, current.working_version_id);
  const [updated] = await db.batch([
    projectUpdate,
    db
      .prepare(`UPDATE project_versions
      SET title = ?, description = ?, project_type = ?, included_types = ?,
          tags = ?, schema_version = COALESCE(schema_version, ?), version_label = ?, requirements = ?,
          cover_position_x = ?, cover_position_y = ?, cover_zoom = ?, discord_thread_url = ?
      WHERE id = ? AND changes() = 1`)
      .bind(
        values.title,
        values.description,
        values.projectType,
        JSON.stringify(values.includedTypes),
        tags,
        values.schemaVersion,
        values.versionLabel,
        values.requirements,
        values.coverPositionX,
        values.coverPositionY,
        values.coverZoom,
        values.discordThreadUrl,
        current.working_version_id,
      ),
    db
      .prepare(`INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      SELECT ?, 'project.patch', 'project', ?, ?, ?, ?
      WHERE changes() = 1`)
      .bind(
        crypto.randomUUID(),
        projectId,
        session.userId,
        JSON.stringify({ fields: Object.keys(input), rowVersion: expectedVersion + 1 }),
        now,
      ),
  ]);
  if (!updated || updated.meta.changes === 0) return null;
  return { rowVersion: expectedVersion + 1, versionId: current.working_version_id };
}

interface VersionCounts {
  worldbook: number;
  regex: number;
}

export interface VersionAssetInput {
  kind: string;
  r2Key: string;
  sha256: string;
  bytes: number;
  mime: string;
}

interface VersionOptions {
  versionId?: string;
  counts?: VersionCounts;
  assets?: VersionAssetInput[];
}

export async function addVersion(
  db: D1Database,
  session: Session,
  current: WorkingVersionRow,
  expectedVersion: number,
  values: VersionValues,
  options: VersionOptions = {},
): Promise<VersionResult | null> {
  const versionId = options.versionId ?? crypto.randomUUID();
  const counts = options.counts ?? { worldbook: 0, regex: 0 };
  const now = new Date().toISOString();
  const tags = JSON.stringify(values.tags);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE projects SET working_version_id = ?, row_version = row_version + 1,
        updated_at = CASE WHEN published_version_id IS NULL OR published_version_id = ? THEN ? ELSE updated_at END
      WHERE id = ? AND row_version = ? AND working_version_id = ? AND deleted_at IS NULL`)
      .bind(versionId, versionId, now, current.id, expectedVersion, current.working_version_id),
    db
      .prepare(`INSERT INTO project_versions
      (id, project_id, version_no, title, description, project_type, included_types,
       schema_version, version_label, requirements, cover_position_x, cover_position_y, cover_zoom,
       discord_thread_url, tags, worldbook_count, regex_count, created_by, created_at)
      SELECT ?, ?, (SELECT COALESCE(MAX(version_no), 0) + 1 FROM project_versions WHERE project_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM projects
        WHERE id = ? AND row_version = ? AND working_version_id = ?
      )`)
      .bind(
        versionId,
        current.id,
        current.id,
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
        counts.worldbook,
        counts.regex,
        session.userId,
        now,
        current.id,
        expectedVersion + 1,
        versionId,
      ),
  ];
  for (const asset of options.assets ?? []) {
    statements.push(
      db
        .prepare(`INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND working_version_id = ?)
          AND NOT EXISTS (SELECT 1 FROM submissions WHERE version_id = ?)`)
        .bind(
          crypto.randomUUID(),
          current.id,
          versionId,
          asset.kind,
          asset.r2Key,
          asset.sha256,
          asset.bytes,
          asset.mime,
          current.id,
          versionId,
          versionId,
        ),
    );
  }
  const [updated] = await db.batch(statements);
  if (!updated || updated.meta.changes === 0) return null;
  return { rowVersion: expectedVersion + 1, versionId };
}

export async function createVersion(
  db: D1Database,
  session: Session,
  projectId: string,
  expectedVersion: number,
  input: PatchProject,
): Promise<VersionResult | null> {
  const current = await getWorkingVersion(db, projectId, session);
  if (!current || current.row_version !== expectedVersion) return null;
  const sourceAssets = current.working_version_id
    ? await db
        .prepare("SELECT kind, r2_key, sha256, bytes, mime FROM assets WHERE version_id = ?")
        .bind(current.working_version_id)
        .all<{ kind: string; r2_key: string; sha256: string; bytes: number; mime: string }>()
    : { results: [] };
  return addVersion(db, session, current, expectedVersion, versionValues(current, input), {
    counts: {
      worldbook: current.version_worldbook_count ?? 0,
      regex: current.version_regex_count ?? 0,
    },
    assets: sourceAssets.results.map((asset) => ({
      kind: asset.kind,
      r2Key: asset.r2_key,
      sha256: asset.sha256,
      bytes: asset.bytes,
      mime: asset.mime,
    })),
  });
}

export interface VersionAccess {
  id: string;
  project_id: string;
  version_no: number;
  working_version_id: string | null;
}

export async function getVersionForProject(
  db: D1Database,
  projectId: string,
  versionId: string,
  session: Session,
): Promise<VersionAccess | null> {
  return db
    .prepare(`SELECT r.id, r.project_id, r.version_no, p.working_version_id
    FROM project_versions r JOIN projects p ON p.id = r.project_id
    WHERE r.id = ? AND r.project_id = ? AND p.deleted_at IS NULL
      AND p.working_version_id = r.id
      AND (p.published_version_id IS NULL OR p.published_version_id <> r.id)
      AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.version_id = r.id)
      AND (p.author_id = ? OR ? = 'owner')`)
    .bind(versionId, projectId, session.userId, session.role)
    .first<VersionAccess>();
}
