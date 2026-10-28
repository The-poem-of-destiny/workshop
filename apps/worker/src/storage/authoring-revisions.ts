import type { PatchProject, Session } from "@workshop/contracts";
import {
  getWorkingRevision,
  metadataSnapshot,
  type RevisionResult,
  type RevisionValues,
  revisionValues,
  type WorkingRevisionRow,
} from "./authoring-model.js";

export async function patchProject(
  db: D1Database,
  session: Session,
  projectId: string,
  expectedVersion: number,
  input: PatchProject,
): Promise<RevisionResult | null> {
  const current = await getWorkingRevision(db, projectId, session);
  if (!current || current.row_version !== expectedVersion || !current.working_revision_id) return null;
  if (current.working_revision_frozen) return null;
  const values = revisionValues(current, input);
  const now = new Date().toISOString();
  const meta = metadataSnapshot(values, session.userId, now);
  const tags = JSON.stringify(values.tags);
  const preservePublished =
    current.published_revision_id !== null && current.published_revision_id !== current.working_revision_id;
  const projectUpdate = preservePublished
    ? db
        .prepare(`UPDATE projects
      SET row_version = row_version + 1
      WHERE id = ? AND row_version = ? AND working_revision_id = ?
        AND deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM submissions WHERE revision_id = projects.working_revision_id)`)
        .bind(projectId, expectedVersion, current.working_revision_id)
    : db
        .prepare(`UPDATE projects
      SET title = ?, description = ?, author_note = ?, project_type = ?, extension_type = ?,
          search_tags = ?, version_label = ?, precautions = ?, cover_position_x = ?,
          cover_position_y = ?, cover_zoom = ?, metadata_findings = ?,
          metadata_checker_revision = ?, metadata_checked_at = ?, metadata_checked_by = ?,
          row_version = row_version + 1, updated_at = ?
      WHERE id = ? AND row_version = ? AND working_revision_id = ?
        AND deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM submissions WHERE revision_id = projects.working_revision_id)`)
        .bind(
          values.title,
          values.description,
          values.authorNote,
          values.projectType,
          values.extensionType,
          tags,
          values.versionLabel,
          values.precautions,
          values.coverPositionX,
          values.coverPositionY,
          values.coverZoom,
          meta.findings,
          meta.revision,
          meta.checkedAt,
          meta.actorId,
          now,
          projectId,
          expectedVersion,
          current.working_revision_id,
        );
  const [updated] = await db.batch([
    projectUpdate,
    db
      .prepare(`UPDATE project_revisions
      SET title = ?, description = ?, author_note = ?, project_type = ?, extension_type = ?,
          tags = ?, schema_version = COALESCE(schema_version, ?), version_label = ?, precautions = ?,
          cover_position_x = ?, cover_position_y = ?, cover_zoom = ?, metadata_findings = ?,
          metadata_checker_revision = ?, metadata_checked_at = ?, metadata_checked_by = ?,
          discord_thread_url = ?
      WHERE id = ? AND changes() = 1`)
      .bind(
        values.title,
        values.description,
        values.authorNote,
        values.projectType,
        values.extensionType,
        tags,
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
        current.working_revision_id,
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
  return { rowVersion: expectedVersion + 1, revisionId: current.working_revision_id };
}

interface RevisionCounts {
  worldbook: number;
  regex: number;
}

export interface RevisionAssetInput {
  kind: string;
  r2Key: string;
  sha256: string;
  bytes: number;
  mime: string;
}

interface RevisionOptions {
  revisionId?: string;
  counts?: RevisionCounts;
  assets?: RevisionAssetInput[];
}

export async function addRevision(
  db: D1Database,
  session: Session,
  current: WorkingRevisionRow,
  expectedVersion: number,
  values: RevisionValues,
  options: RevisionOptions = {},
): Promise<RevisionResult | null> {
  const revisionId = options.revisionId ?? crypto.randomUUID();
  const counts = options.counts ?? { worldbook: 0, regex: 0 };
  const now = new Date().toISOString();
  const nextNo = current.revision_no + 1;
  const tags = JSON.stringify(values.tags);
  const meta = metadataSnapshot(values, session.userId, now);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE projects SET working_revision_id = ?, row_version = row_version + 1,
        updated_at = CASE WHEN published_revision_id IS NULL OR published_revision_id = ? THEN ? ELSE updated_at END
      WHERE id = ? AND row_version = ? AND working_revision_id = ?`)
      .bind(revisionId, revisionId, now, current.id, expectedVersion, current.working_revision_id),
    db
      .prepare(`INSERT INTO project_revisions
      (id, project_id, revision_no, title, description, author_note, project_type, extension_type,
       schema_version, version_label, precautions, cover_position_x, cover_position_y, cover_zoom,
       metadata_findings, metadata_checker_revision, metadata_checked_at, metadata_checked_by,
       discord_thread_url, tags, worldbook_count, regex_count, created_by, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM projects
        WHERE id = ? AND row_version = ? AND working_revision_id = ?
      )`)
      .bind(
        revisionId,
        current.id,
        nextNo,
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
        counts.worldbook,
        counts.regex,
        session.userId,
        now,
        current.id,
        expectedVersion + 1,
        revisionId,
      ),
  ];
  for (const asset of options.assets ?? []) {
    statements.push(
      db
        .prepare(`INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND working_revision_id = ?)
          AND NOT EXISTS (SELECT 1 FROM submissions WHERE revision_id = ?)`)
        .bind(
          crypto.randomUUID(),
          current.id,
          revisionId,
          asset.kind,
          asset.r2Key,
          asset.sha256,
          asset.bytes,
          asset.mime,
          current.id,
          revisionId,
          revisionId,
        ),
    );
  }
  const [updated] = await db.batch(statements);
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
  const sourceAssets = current.working_revision_id
    ? await db
        .prepare("SELECT kind, r2_key, sha256, bytes, mime FROM assets WHERE revision_id = ?")
        .bind(current.working_revision_id)
        .all<{ kind: string; r2_key: string; sha256: string; bytes: number; mime: string }>()
    : { results: [] };
  return addRevision(db, session, current, expectedVersion, revisionValues(current, input), {
    counts: {
      worldbook: current.revision_worldbook_count ?? 0,
      regex: current.revision_regex_count ?? 0,
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
  return db
    .prepare(`SELECT r.id, r.project_id, r.revision_no, p.working_revision_id
    FROM project_revisions r JOIN projects p ON p.id = r.project_id
    WHERE r.id = ? AND r.project_id = ? AND p.deleted_at IS NULL
      AND p.working_revision_id = r.id
      AND (p.published_revision_id IS NULL OR p.published_revision_id <> r.id)
      AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.revision_id = r.id)
      AND (p.author_id = ? OR ? = 'owner')`)
    .bind(revisionId, projectId, session.userId, session.role)
    .first<RevisionAccess>();
}
