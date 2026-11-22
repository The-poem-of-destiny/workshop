import { deleteCoverReplica, reserveCoverReplica } from "./cover-replica.js";

interface GalleryReplicaEnv {
  DB: D1Database;
  R2: R2Bucket;
  PUBLIC_COVERS?: R2Bucket;
}

const galleryKinds = ["gallery_1", "gallery_2"] as const;
type GalleryKind = (typeof galleryKinds)[number];

async function replicateSlot(env: GalleryReplicaEnv, bucket: R2Bucket, projectId: string, kind: GalleryKind) {
  const key = `covers/gallery/${crypto.randomUUID()}`;
  const candidate =
    await env.DB.prepare(`INSERT INTO public_gallery_replicas (project_id, kind, asset_id, object_key, phase)
    SELECT p.id, a.kind, a.id, ?, 'reserving' FROM projects p JOIN assets a ON a.project_id = p.id
    WHERE p.id = ? AND p.visibility = 'public' AND p.deleted_at IS NULL AND p.published_version_id IS NOT NULL
      AND a.kind = ? AND a.version_id IS NULL
      AND a.mime IN ('image/png', 'image/jpeg', 'image/webp')
    ON CONFLICT(project_id, kind) DO NOTHING RETURNING object_key`)
      .bind(key, projectId, kind)
      .first();

  if (candidate) {
    // Only the request that created the durable row may reserve this key. A
    // failed/ambiguous reservation must never be retried or withdrawn blindly.
    const reservation = await reserveCoverReplica(bucket, key);
    if (!reservation) throw new Error("Public gallery reservation collision");
    await env.DB.prepare(`UPDATE public_gallery_replicas SET phase = 'copying', reservation_etag = ?
      WHERE project_id = ? AND kind = ? AND object_key = ? AND phase = 'reserving'`)
      .bind(reservation.etag, projectId, kind, key)
      .run();
  }

  const asset = await env.DB.prepare(`SELECT g.object_key, g.reservation_etag, a.r2_key, a.sha256, a.bytes, a.mime
    FROM public_gallery_replicas g JOIN assets a ON a.project_id = g.project_id AND a.id = g.asset_id
    WHERE g.project_id = ? AND g.kind = ? AND g.phase = 'copying'
      AND a.kind = g.kind AND a.version_id IS NULL`)
    .bind(projectId, kind)
    .first<{
      object_key: string;
      reservation_etag: string;
      r2_key: string;
      sha256: string;
      bytes: number;
      mime: string;
    }>();
  if (!asset) return;

  const source = await env.R2.get(asset.r2_key);
  if (!source) return;
  try {
    if (source.size !== asset.bytes) return;
    const copy = await bucket.put(asset.object_key, source.body, {
      onlyIf: { etagMatches: asset.reservation_etag },
      httpMetadata: { contentType: asset.mime, cacheControl: "public, max-age=0, must-revalidate" },
      sha256: asset.sha256,
    });
    if (!copy) {
      // A retry can observe that the earlier conditional copy succeeded before
      // its D1 acknowledgement. Only recognize the complete expected image.
      const existing = await bucket.head(asset.object_key);
      if (
        existing?.size !== asset.bytes ||
        existing.httpMetadata?.contentType !== asset.mime ||
        existing.checksums.toJSON().sha256 !== asset.sha256
      )
        return;
    }
  } finally {
    if (!source.body.locked) await source.body.cancel();
  }
  await env.DB.prepare(`UPDATE public_gallery_replicas SET phase = 'ready'
    WHERE project_id = ? AND kind = ? AND object_key = ? AND phase = 'copying'`)
    .bind(projectId, kind, asset.object_key)
    .run();
}

export async function replicatePublicGallery(env: GalleryReplicaEnv, projectId: string, slot?: number): Promise<void> {
  const bucket = env.PUBLIC_COVERS;
  if (!bucket) return;
  if (slot !== undefined) {
    const kind = galleryKinds[slot];
    if (kind !== undefined) await replicateSlot(env, bucket, projectId, kind);
    return;
  }
  for (const kind of galleryKinds) await replicateSlot(env, bucket, projectId, kind);
}

// A reserving row may still have a PUT in flight. Leave it fenced. A copying
// row can be deleted: its conditional image PUT cannot land after deletion.
export async function withdrawPublicGallery(
  env: GalleryReplicaEnv,
  projectId: string,
  slot?: number,
  expectedVersion?: number,
): Promise<boolean> {
  const bucket = env.PUBLIC_COVERS;
  const kind = slot === undefined ? null : galleryKinds[slot];
  if (kind === undefined) return true;
  const scope = `project_id = ?${kind === null ? "" : " AND kind = ?"}${
    expectedVersion === undefined
      ? ""
      : " AND EXISTS (SELECT 1 FROM projects p WHERE p.id = public_gallery_replicas.project_id AND p.row_version = ?)"
  }`;
  const binds: Array<string | number> = [projectId];
  if (kind !== null) binds.push(kind);
  if (expectedVersion !== undefined) binds.push(expectedVersion);
  if (bucket) {
    const replicas = await env.DB.prepare(`UPDATE public_gallery_replicas SET phase = 'withdrawing'
      WHERE ${scope} AND phase <> 'reserving' RETURNING object_key`)
      .bind(...binds)
      .all<{ object_key: string }>();
    for (const replica of replicas.results) {
      await deleteCoverReplica(bucket, replica.object_key);
      await env.DB.prepare(`DELETE FROM public_gallery_replicas
        WHERE object_key = ? AND phase = 'withdrawing'`)
        .bind(replica.object_key)
        .run();
    }
  }
  const pending = await env.DB.prepare(`SELECT 1 FROM public_gallery_replicas WHERE ${scope}`)
    .bind(...binds)
    .first();
  return !pending;
}
