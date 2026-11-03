import type { ProjectGalleryResponse, Session } from "@workshop/contracts";
import { type ImageDimensions, WORKSHOP_LIMITS } from "@workshop/domain";

type GalleryRow = { slot: number; r2_key: string; mime: string };

const MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function galleryKey(projectId: string, slot: number, sha256: string, mime: string): string {
  return `gallery/${projectId}/gallery_${slot + 1}-${sha256}.${MIME_EXT[mime]!}`;
}

function authorizedProjectSql(): string {
  return `id = ? AND deleted_at IS NULL AND (author_id = ? OR ? = 'owner')`;
}

export async function getAuthorGallery(
  db: D1Database,
  projectId: string,
  session: Session,
): Promise<ProjectGalleryResponse | null> {
  const project = await db
    .prepare(`SELECT row_version FROM projects WHERE ${authorizedProjectSql()}`)
    .bind(projectId, session.userId, session.role)
    .first<{ row_version: number }>();
  if (!project) return null;
  const rows = await db
    .prepare(
      "SELECT CASE kind WHEN 'gallery_1' THEN 0 ELSE 1 END AS slot, r2_key FROM assets WHERE project_id = ? AND version_id IS NULL AND kind IN ('gallery_1', 'gallery_2') ORDER BY kind",
    )
    .bind(projectId)
    .all<GalleryRow>();
  return {
    rowVersion: project.row_version,
    images: rows.results.map((row) => ({ slot: row.slot, url: `/api/v1/assets/${row.r2_key}` })),
  };
}

export async function getPublicGallery(db: D1Database, projectId: string): Promise<GalleryRow[] | null> {
  const project = await db
    .prepare(
      `SELECT p.id FROM projects p JOIN project_versions r ON r.id = p.published_version_id AND r.project_id = p.id
       WHERE p.id = ? AND p.deleted_at IS NULL AND p.visibility = 'public' AND p.published_version_id IS NOT NULL`,
    )
    .bind(projectId)
    .first<{ id: string }>();
  if (!project) return null;
  const rows = await db
    .prepare(
      "SELECT CASE kind WHEN 'gallery_1' THEN 0 ELSE 1 END AS slot, r2_key, mime FROM assets WHERE project_id = ? AND version_id IS NULL AND kind IN ('gallery_1', 'gallery_2') ORDER BY kind",
    )
    .bind(projectId)
    .all<GalleryRow>();
  return rows.results;
}

export type GalleryWriteResult =
  | { kind: "ok"; rowVersion: number; sha256: string; bytes: number; mime: string; r2Key: string }
  | { kind: "conflict" }
  | { kind: "invalid"; message: string };

export async function uploadGalleryImage(
  db: D1Database,
  session: Session,
  projectId: string,
  slot: number,
  expectedVersion: number,
  body: {
    bytes: number;
    sha256: string;
    dimensions: ImageDimensions | null;
    copyTo: (key: string, options?: R2PutOptions) => Promise<void>;
  },
  mime: string,
): Promise<GalleryWriteResult> {
  if (!Number.isInteger(slot) || slot < 0 || slot > 1)
    return { kind: "invalid", message: "Gallery slot must be 0 or 1" };
  if (!MIME_EXT[mime]) return { kind: "invalid", message: "Unsupported content type" };
  if (body.bytes === 0 || body.bytes > WORKSHOP_LIMITS.projectImageUploadBytes) {
    return { kind: "invalid", message: "Gallery image exceeds 5MiB limit" };
  }
  const dimensions = body.dimensions;
  if (!dimensions || dimensions.mime !== mime)
    return { kind: "invalid", message: "Image format does not match content type" };
  if (dimensions.width > WORKSHOP_LIMITS.coverMaxDimension || dimensions.height > WORKSHOP_LIMITS.coverMaxDimension) {
    return { kind: "invalid", message: "Image dimensions cannot exceed 4096×4096" };
  }
  const sha256 = body.sha256;
  const r2Key = galleryKey(projectId, slot, sha256, mime);
  try {
    await body.copyTo(r2Key, { httpMetadata: { contentType: mime } });
  } catch {
    return { kind: "invalid", message: "Image storage failed" };
  }
  const now = new Date().toISOString();
  let results: Array<{ meta: { changes: number } }>;
  try {
    results = await db.batch([
      db
        .prepare(
          `UPDATE assets SET r2_key = ?, sha256 = ?, bytes = ?, mime = ?, created_at = ?
           WHERE project_id = ? AND kind = ? AND version_id IS NULL AND EXISTS (SELECT 1 FROM projects WHERE ${authorizedProjectSql()} AND row_version = ?)`,
        )
        .bind(
          r2Key,
          sha256,
          body.bytes,
          mime,
          now,
          projectId,
          `gallery_${slot + 1}`,
          projectId,
          session.userId,
          session.role,
          expectedVersion,
        ),
      db
        .prepare(
          `INSERT INTO assets (id, project_id, kind, r2_key, sha256, bytes, mime, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM projects WHERE ${authorizedProjectSql()} AND row_version = ?)
             AND NOT EXISTS (SELECT 1 FROM assets WHERE project_id = ? AND kind = ? AND version_id IS NULL)`,
        )
        .bind(
          crypto.randomUUID(),
          projectId,
          `gallery_${slot + 1}`,
          r2Key,
          sha256,
          body.bytes,
          mime,
          now,
          projectId,
          session.userId,
          session.role,
          expectedVersion,
          projectId,
          `gallery_${slot + 1}`,
        ),
      db
        .prepare(
          `UPDATE projects SET row_version = row_version + 1, updated_at = ?
           WHERE ${authorizedProjectSql()} AND row_version = ?
             AND EXISTS (SELECT 1 FROM assets WHERE project_id = ? AND kind = ? AND version_id IS NULL)`,
        )
        .bind(now, projectId, session.userId, session.role, expectedVersion, projectId, `gallery_${slot + 1}`),
    ]);
  } catch {
    // Immutable objects remain for a separately authorized orphan sweep.
    return { kind: "invalid", message: "Gallery update failed" };
  }
  if ((results[2]?.meta.changes ?? 0) === 0) {
    return { kind: "conflict" };
  }
  return { kind: "ok", rowVersion: expectedVersion + 1, sha256, bytes: body.bytes, mime, r2Key };
}

export async function deleteGalleryImage(
  db: D1Database,
  session: Session,
  projectId: string,
  slot: number,
  expectedVersion: number,
): Promise<{ kind: "ok"; rowVersion: number } | { kind: "conflict" } | { kind: "invalid"; message: string }> {
  if (!Number.isInteger(slot) || slot < 0 || slot > 1)
    return { kind: "invalid", message: "Gallery slot must be 0 or 1" };
  const current = await db
    .prepare(
      `SELECT p.row_version
       FROM projects p JOIN assets g ON g.project_id = p.id AND g.kind = ? AND g.version_id IS NULL
       WHERE ${authorizedProjectSql()}`,
    )
    .bind(`gallery_${slot + 1}`, projectId, session.userId, session.role)
    .first<{ row_version: number }>();
  if (!current || current.row_version !== expectedVersion) return { kind: "conflict" };
  const now = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM assets
         WHERE project_id = ? AND kind = ? AND version_id IS NULL AND EXISTS (SELECT 1 FROM projects WHERE ${authorizedProjectSql()} AND row_version = ?)`,
      )
      .bind(projectId, `gallery_${slot + 1}`, projectId, session.userId, session.role, expectedVersion),
    db
      .prepare(
        `UPDATE projects SET row_version = row_version + 1, updated_at = ?
         WHERE ${authorizedProjectSql()} AND row_version = ?`,
      )
      .bind(now, projectId, session.userId, session.role, expectedVersion),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0 || (results[1]?.meta.changes ?? 0) === 0) return { kind: "conflict" };
  return { kind: "ok", rowVersion: expectedVersion + 1 };
}
