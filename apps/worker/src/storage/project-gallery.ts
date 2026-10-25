import type { ProjectGalleryResponse, Session } from "@workshop/contracts";
import { detectImageDimensions, WORKSHOP_LIMITS } from "@workshop/domain";

type GalleryRow = { slot: number; r2_key: string; mime: string };

const MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function galleryKey(projectId: string, slot: number, sha256: string, mime: string): string {
  return `gallery/${projectId}/${slot}-${sha256}.${MIME_EXT[mime]!}`;
}

async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function deleteIfUnreferenced(db: D1Database, r2: R2Bucket, r2Key: string): Promise<void> {
  try {
    const referenced = await db.prepare("SELECT 1 FROM project_gallery WHERE r2_key = ? LIMIT 1").bind(r2Key).first();
    if (!referenced) await r2.delete(r2Key);
  } catch {
    // Preserve the object when D1 is unavailable; a later GC can verify references.
  }
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
    .prepare("SELECT slot, r2_key FROM project_gallery WHERE project_id = ? ORDER BY slot")
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
      `SELECT p.id FROM projects p JOIN project_revisions r ON r.id = p.published_revision_id AND r.project_id = p.id
       WHERE p.id = ? AND p.deleted_at IS NULL AND p.visibility = 'public' AND p.published_revision_id IS NOT NULL`,
    )
    .bind(projectId)
    .first<{ id: string }>();
  if (!project) return null;
  const rows = await db
    .prepare("SELECT slot, r2_key, mime FROM project_gallery WHERE project_id = ? ORDER BY slot")
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
  r2: R2Bucket,
  session: Session,
  projectId: string,
  slot: number,
  expectedVersion: number,
  body: ArrayBuffer,
  mime: string,
): Promise<GalleryWriteResult> {
  if (!Number.isInteger(slot) || slot < 0 || slot > 1)
    return { kind: "invalid", message: "Gallery slot must be 0 or 1" };
  if (!MIME_EXT[mime]) return { kind: "invalid", message: "Unsupported content type" };
  if (body.byteLength === 0 || body.byteLength > WORKSHOP_LIMITS.projectImageUploadBytes) {
    return { kind: "invalid", message: "Gallery image exceeds 5MiB limit" };
  }
  const dimensions = detectImageDimensions(new Uint8Array(body));
  if (!dimensions || dimensions.mime !== mime)
    return { kind: "invalid", message: "Image format does not match content type" };
  if (dimensions.width > WORKSHOP_LIMITS.coverMaxDimension || dimensions.height > WORKSHOP_LIMITS.coverMaxDimension) {
    return { kind: "invalid", message: "Image dimensions cannot exceed 4096×4096" };
  }
  const sha256 = await sha256Hex(body);
  const r2Key = galleryKey(projectId, slot, sha256, mime);
  try {
    await r2.put(r2Key, body, { httpMetadata: { contentType: mime } });
  } catch {
    return { kind: "invalid", message: "Image storage failed" };
  }
  const now = new Date().toISOString();
  let results: Array<{ meta: { changes: number } }>;
  try {
    results = await db.batch([
      db
        .prepare(
          `UPDATE project_gallery SET r2_key = ?, sha256 = ?, bytes = ?, mime = ?, created_at = ?
           WHERE project_id = ? AND slot = ? AND EXISTS (SELECT 1 FROM projects WHERE ${authorizedProjectSql()} AND row_version = ?)`,
        )
        .bind(
          r2Key,
          sha256,
          body.byteLength,
          mime,
          now,
          projectId,
          slot,
          projectId,
          session.userId,
          session.role,
          expectedVersion,
        ),
      db
        .prepare(
          `INSERT INTO project_gallery (project_id, slot, r2_key, sha256, bytes, mime, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM projects WHERE ${authorizedProjectSql()} AND row_version = ?)
             AND NOT EXISTS (SELECT 1 FROM project_gallery WHERE project_id = ? AND slot = ?)`,
        )
        .bind(
          projectId,
          slot,
          r2Key,
          sha256,
          body.byteLength,
          mime,
          now,
          projectId,
          session.userId,
          session.role,
          expectedVersion,
          projectId,
          slot,
        ),
      db
        .prepare(
          `UPDATE projects SET row_version = row_version + 1, updated_at = ?
           WHERE ${authorizedProjectSql()} AND row_version = ?
             AND EXISTS (SELECT 1 FROM project_gallery WHERE project_id = ? AND slot = ?)`,
        )
        .bind(now, projectId, session.userId, session.role, expectedVersion, projectId, slot),
    ]);
  } catch {
    await deleteIfUnreferenced(db, r2, r2Key);
    return { kind: "invalid", message: "Gallery update failed" };
  }
  if ((results[2]?.meta.changes ?? 0) === 0) {
    await deleteIfUnreferenced(db, r2, r2Key);
    return { kind: "conflict" };
  }
  return { kind: "ok", rowVersion: expectedVersion + 1, sha256, bytes: body.byteLength, mime, r2Key };
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
       FROM projects p JOIN project_gallery g ON g.project_id = p.id AND g.slot = ?
       WHERE ${authorizedProjectSql()}`,
    )
    .bind(slot, projectId, session.userId, session.role)
    .first<{ row_version: number }>();
  if (!current || current.row_version !== expectedVersion) return { kind: "conflict" };
  const now = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM project_gallery
         WHERE project_id = ? AND slot = ? AND EXISTS (SELECT 1 FROM projects WHERE ${authorizedProjectSql()} AND row_version = ?)`,
      )
      .bind(projectId, slot, projectId, session.userId, session.role, expectedVersion),
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
