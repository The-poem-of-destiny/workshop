import type { PatchProject, Session } from "@workshop/contracts";
import {
  detectImageDimensions,
  inspectProjectMetadata,
  METADATA_CHECKER_REVISION,
  type MetadataFinding,
  WORKSHOP_LIMITS,
} from "@workshop/domain";

export type PublishedMetadataPatch = PatchProject;

const COVER_MIME: Record<string, true> = {
  "image/png": true,
  "image/jpeg": true,
  "image/webp": true,
};

interface DisplayRow {
  id: string;
  author_id: string;
  row_version: number;
  published_revision_id: string | null;
  title: string;
  description: string | null;
  author_note: string | null;
  project_type: string | null;
  extension_type: string | null;
  search_tags: string;
  version_label: string | null;
  precautions: string | null;
  cover_position_x: number;
  cover_position_y: number;
  cover_zoom: number;
  published_cover_asset_id: string | null;
  published_schema_version: string | null;
  published_discord_thread_url: string | null;
}

export type PublishedDisplayMetadata = {
  title: string;
  description: string | null;
  authorNote: string | null;
  projectType: string | null;
  extensionType: string | null;
  schemaVersion: string | null;
  discordThreadUrl: string | null;
  tags: string[];
  versionLabel: string | null;
  precautions: string | null;
  coverPositionX: number;
  coverPositionY: number;
  coverZoom: number;
};
type DisplayMetadata = PublishedDisplayMetadata;

function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function displayMetadata(current: DisplayRow, patch: PublishedMetadataPatch): DisplayMetadata {
  return {
    title: patch.title ?? current.title,
    description: patch.description !== undefined ? patch.description : current.description,
    authorNote: patch.authorNote !== undefined ? patch.authorNote : current.author_note,
    projectType: patch.projectType !== undefined ? patch.projectType : current.project_type,
    extensionType: patch.extensionType !== undefined ? patch.extensionType : current.extension_type,
    schemaVersion: patch.schemaVersion !== undefined ? patch.schemaVersion : current.published_schema_version,
    discordThreadUrl:
      patch.discordThreadUrl !== undefined ? patch.discordThreadUrl : current.published_discord_thread_url,
    tags: patch.tags !== undefined ? patch.tags : parseTags(current.search_tags),
    versionLabel: patch.versionLabel !== undefined ? patch.versionLabel : current.version_label,
    precautions: patch.precautions !== undefined ? patch.precautions : current.precautions,
    coverPositionX: patch.coverPositionX ?? current.cover_position_x,
    coverPositionY: patch.coverPositionY ?? current.cover_position_y,
    coverZoom: patch.coverZoom ?? current.cover_zoom,
  };
}

async function displayProject(db: D1Database, projectId: string, session: Session): Promise<DisplayRow | null> {
  return db
    .prepare(`
      SELECT p.id, p.author_id, p.row_version, p.published_revision_id, p.title, p.description,
             p.author_note, p.project_type, p.extension_type, p.search_tags, p.version_label,
             p.precautions, p.cover_position_x, p.cover_position_y, p.cover_zoom,
             p.published_cover_asset_id,
             p.published_schema_version AS published_schema_version,
             p.published_discord_thread_url AS published_discord_thread_url
      FROM projects p
      WHERE p.id = ? AND p.deleted_at IS NULL AND (p.author_id = ? OR ? = 'owner')
    `)
    .bind(projectId, session.userId, session.role)
    .first<DisplayRow>();
}
export async function getPublishedMetadata(
  db: D1Database,
  projectId: string,
  session: Session,
): Promise<PublishedDisplayMetadata | null> {
  const current = await displayProject(db, projectId, session);
  return current?.published_revision_id ? displayMetadata(current, {}) : null;
}

export type PublishedMetadataUpdate =
  | { kind: "ok"; rowVersion: number }
  | { kind: "conflict" }
  | { kind: "invalid"; findings: MetadataFinding[] };

/**
 * Changes the public display projection without mutating its frozen published
 * revision or any pending revision snapshot.
 */
export async function updatePublishedMetadata(
  db: D1Database,
  session: Session,
  projectId: string,
  expectedVersion: number,
  patch: PublishedMetadataPatch,
): Promise<PublishedMetadataUpdate> {
  const current = await displayProject(db, projectId, session);
  if (!current || current.row_version !== expectedVersion || !current.published_revision_id) {
    return { kind: "conflict" };
  }
  const values = displayMetadata(current, patch);
  const inspection = inspectProjectMetadata({
    title: values.title,
    description: values.description,
    authorNote: values.authorNote,
    precautions: values.precautions,
    versionLabel: values.versionLabel,
    tags: values.tags,
    coverPositionX: values.coverPositionX,
    coverPositionY: values.coverPositionY,
    coverZoom: values.coverZoom,
  });
  if (inspection.gate === "block") return { kind: "invalid", findings: inspection.findings };

  const now = new Date().toISOString();
  const [updated] = await db.batch([
    db
      .prepare(`
        UPDATE projects
        SET title = ?, description = ?, author_note = ?, project_type = ?, extension_type = ?,
            published_schema_version = ?, published_discord_thread_url = ?, search_tags = ?,
            version_label = ?, precautions = ?, cover_position_x = ?, cover_position_y = ?,
            cover_zoom = ?, metadata_findings = ?, metadata_checker_revision = ?,
            metadata_checked_at = ?, metadata_checked_by = ?, row_version = row_version + 1,
            updated_at = ?
        WHERE id = ? AND row_version = ? AND deleted_at IS NULL
          AND published_revision_id IS NOT NULL
          AND (author_id = ? OR ? = 'owner')
      `)
      .bind(
        values.title,
        values.description,
        values.authorNote,
        values.projectType,
        values.extensionType,
        values.schemaVersion,
        values.discordThreadUrl,
        JSON.stringify(values.tags),
        values.versionLabel,
        values.precautions,
        values.coverPositionX,
        values.coverPositionY,
        values.coverZoom,
        JSON.stringify(inspection.findings),
        METADATA_CHECKER_REVISION,
        now,
        session.userId,
        now,
        projectId,
        expectedVersion,
        session.userId,
        session.role,
      ),
    db
      .prepare(`
        INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        SELECT ?, 'project.published_metadata.patch', 'project', ?, ?, ?, ?
        WHERE changes() = 1
      `)
      .bind(
        crypto.randomUUID(),
        projectId,
        session.userId,
        JSON.stringify({ fields: Object.keys(patch), rowVersion: expectedVersion + 1 }),
        now,
      ),
  ]);
  return (updated?.meta.changes ?? 0) > 0 ? { kind: "ok", rowVersion: expectedVersion + 1 } : { kind: "conflict" };
}

async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function coverKey(projectId: string, sha256: string, mime: string): string {
  const extension: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  return `covers/${projectId}/published-${sha256}.${extension[mime]!}`;
}

export type PublishedCoverUpdate =
  | { kind: "ok"; rowVersion: number; r2Key: string; sha256: string; bytes: number; mime: string }
  | { kind: "conflict" }
  | { kind: "invalid"; message: string };

/**
 * Stores immutable bytes before atomically switching the project-level display
 * association. An unsuccessful CAS can leave an unreferenced R2 object only.
 */
export async function updatePublishedCover(
  db: D1Database,
  r2: R2Bucket,
  session: Session,
  projectId: string,
  expectedVersion: number,
  body: ArrayBuffer,
  mime: string,
): Promise<PublishedCoverUpdate> {
  if (!COVER_MIME[mime]) {
    return { kind: "invalid", message: "Unsupported content type" };
  }
  if (body.byteLength === 0 || body.byteLength > WORKSHOP_LIMITS.projectImageUploadBytes) {
    return { kind: "invalid", message: "File exceeds 5MiB limit" };
  }
  const dimensions = detectImageDimensions(new Uint8Array(body));
  if (!dimensions || dimensions.mime !== mime)
    return { kind: "invalid", message: "Image format does not match content type" };
  if (dimensions.width > WORKSHOP_LIMITS.coverMaxDimension || dimensions.height > WORKSHOP_LIMITS.coverMaxDimension) {
    return { kind: "invalid", message: "封面尺寸不能超过 4096×4096" };
  }

  const current = await displayProject(db, projectId, session);
  if (!current || current.row_version !== expectedVersion || !current.published_revision_id) {
    return { kind: "conflict" };
  }

  const sha256 = await sha256Hex(body);
  const r2Key = coverKey(projectId, sha256, mime);
  await r2.put(r2Key, body, { httpMetadata: { contentType: mime } });

  const assetId = current.published_cover_asset_id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(`
        INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime)
        SELECT ?, ?, NULL, 'cover', ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM projects
          WHERE id = ? AND row_version = ? AND deleted_at IS NULL
            AND published_revision_id IS NOT NULL
            AND (author_id = ? OR ? = 'owner')
        )
          AND NOT EXISTS (
            SELECT 1 FROM assets
            WHERE project_id = ? AND revision_id IS NULL AND kind = 'cover'
          )
      `)
      .bind(
        assetId,
        projectId,
        r2Key,
        sha256,
        body.byteLength,
        mime,
        projectId,
        expectedVersion,
        session.userId,
        session.role,
        projectId,
      ),
    db
      .prepare(`
        UPDATE assets
        SET r2_key = ?, sha256 = ?, bytes = ?, mime = ?,
            created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND project_id = ? AND revision_id IS NULL AND kind = 'cover'
          AND EXISTS (
            SELECT 1 FROM projects
            WHERE id = ? AND row_version = ? AND deleted_at IS NULL
              AND published_revision_id IS NOT NULL
              AND (author_id = ? OR ? = 'owner')
          )
      `)
      .bind(
        r2Key,
        sha256,
        body.byteLength,
        mime,
        assetId,
        projectId,
        projectId,
        expectedVersion,
        session.userId,
        session.role,
      ),
    db
      .prepare(`
        UPDATE projects
        SET published_cover_asset_id = ?, row_version = row_version + 1, updated_at = ?
        WHERE id = ? AND row_version = ? AND deleted_at IS NULL
          AND published_revision_id IS NOT NULL
          AND (author_id = ? OR ? = 'owner')
          AND EXISTS (
            SELECT 1 FROM assets
            WHERE id = ? AND project_id = ? AND revision_id IS NULL AND kind = 'cover'
          )
      `)
      .bind(assetId, now, projectId, expectedVersion, session.userId, session.role, assetId, projectId),
    db
      .prepare(`
        INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        SELECT ?, 'project.published_cover.put', 'project', ?, ?, ?, ?
        WHERE changes() = 1
      `)
      .bind(
        crypto.randomUUID(),
        projectId,
        session.userId,
        JSON.stringify({ assetId, sha256, bytes: body.byteLength, rowVersion: expectedVersion + 1 }),
        now,
      ),
  ]);
  if ((results[2]?.meta.changes ?? 0) === 0) {
    const referenced = await db.prepare("SELECT 1 FROM assets WHERE r2_key = ? LIMIT 1").bind(r2Key).first();
    if (!referenced) await r2.delete(r2Key);
    return { kind: "conflict" };
  }
  return { kind: "ok", rowVersion: expectedVersion + 1, r2Key, sha256, bytes: body.byteLength, mime };
}
