import type { ProjectGalleryResponse, Session } from "@workshop/contracts";
import { type ImageDimensions, WORKSHOP_LIMITS } from "@workshop/domain";

type GalleryRow = { slot: number; r2_key: string };

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

type GalleryMutationError =
  | { kind: "conflict" }
  | { kind: "withdrawal_pending" }
  | { kind: "invalid"; message: string };
export type GalleryWriteResult =
  | { kind: "ok"; rowVersion: number; sha256: string; bytes: number; mime: string; r2Key: string }
  | GalleryMutationError;

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
  withdraw: () => Promise<boolean>,
): Promise<GalleryWriteResult> {
  if (!Number.isInteger(slot) || slot < 0 || slot > 1)
    return { kind: "invalid", message: "Gallery slot must be 0 or 1" };
  if (!MIME_EXT[mime]) return { kind: "invalid", message: "Unsupported content type" };
  if (body.bytes === 0 || body.bytes > WORKSHOP_LIMITS.projectImageUploadBytes) {
    return { kind: "invalid", message: "Gallery image exceeds 1MiB limit" };
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
  if (!(await withdraw())) return { kind: "withdrawal_pending" };
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
  } catch (error) {
    if (error instanceof Error && error.message.includes("public_gallery_withdrawal_pending")) {
      return { kind: "withdrawal_pending" };
    }
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
  withdraw: () => Promise<boolean>,
): Promise<{ kind: "ok"; rowVersion: number } | GalleryMutationError> {
  if (!Number.isInteger(slot) || slot < 0 || slot > 1)
    return { kind: "invalid", message: "Gallery slot must be 0 or 1" };
  const current = await db
    .prepare(
      `SELECT row_version FROM projects WHERE ${authorizedProjectSql()}
       AND EXISTS (SELECT 1 FROM assets g WHERE g.project_id = projects.id AND g.kind = ? AND g.version_id IS NULL)`,
    )
    .bind(projectId, session.userId, session.role, `gallery_${slot + 1}`)
    .first<{ row_version: number }>();
  if (!current || current.row_version !== expectedVersion) return { kind: "conflict" };
  if (!(await withdraw())) return { kind: "withdrawal_pending" };
  const now = new Date().toISOString();
  let results: Array<{ meta: { changes: number } }>;
  try {
    results = await db.batch([
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
  } catch (error) {
    if (error instanceof Error && error.message.includes("public_gallery_withdrawal_pending")) {
      return { kind: "withdrawal_pending" };
    }
    throw error;
  }
  if ((results[0]?.meta.changes ?? 0) === 0 || (results[1]?.meta.changes ?? 0) === 0) return { kind: "conflict" };
  return { kind: "ok", rowVersion: expectedVersion + 1 };
}
