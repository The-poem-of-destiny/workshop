import { copyCoverReplica, deleteCoverReplica, reserveCoverReplica } from "./cover-replica";

interface ReplicaEnv {
  DB: D1Database;
  R2: R2Bucket;
  PUBLIC_COVERS?: R2Bucket;
}

export async function replicatePublicCover(env: ReplicaEnv, projectId: string): Promise<void> {
  const bucket = env.PUBLIC_COVERS;
  if (!bucket) return;
  const key = `covers/${crypto.randomUUID()}`;
  const candidate = await env.DB.prepare(`INSERT INTO public_cover_replicas (project_id, object_key, phase)
    SELECT p.id, ?, 'reserving' FROM projects p
    WHERE p.id = ? AND p.visibility = 'public' AND p.deleted_at IS NULL AND p.published_version_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM assets a WHERE a.project_id = p.id AND a.kind = 'cover'
        AND ((a.id = p.published_cover_asset_id AND a.version_id IS NULL)
          OR (p.published_cover_asset_id IS NULL AND a.version_id = p.published_version_id)))
    ON CONFLICT(project_id) DO NOTHING RETURNING project_id`)
    .bind(key, projectId)
    .first();

  if (candidate) {
    const reservation = await reserveCoverReplica(bucket, key);
    if (!reservation) throw new Error("Public cover reservation collision");
    await env.DB.prepare(`UPDATE public_cover_replicas SET phase = 'copying', reservation_etag = ?
      WHERE project_id = ? AND object_key = ? AND phase = 'reserving'`)
      .bind(reservation.etag, projectId, key)
      .run();
  }

  const asset = await env.DB.prepare(`SELECT c.object_key, c.reservation_etag, a.r2_key, a.mime
    FROM projects p JOIN assets a ON a.project_id = p.id
    JOIN public_cover_replicas c ON c.project_id = p.id
    WHERE p.id = ? AND c.phase = 'copying'
      AND p.visibility = 'public' AND p.deleted_at IS NULL AND p.published_version_id IS NOT NULL AND a.kind = 'cover'
      AND ((a.id = p.published_cover_asset_id AND a.version_id IS NULL)
        OR (p.published_cover_asset_id IS NULL AND a.version_id = p.published_version_id))
    LIMIT 1`)
    .bind(projectId)
    .first<{ object_key: string; reservation_etag: string | null; r2_key: string; mime: string }>();
  if (!asset || !asset.reservation_etag) return;
  const source = await env.R2.get(asset.r2_key);
  if (!source) return;
  try {
    const type = source.httpMetadata?.contentType ?? asset.mime;
    if (!type || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(type)) {
      return;
    }
    const copied = await copyCoverReplica(bucket, asset.object_key, asset.reservation_etag, source.body, type);
    if (!copied) {
      const existing = await bucket.head(asset.object_key);
      if (
        !existing ||
        existing.etag === asset.reservation_etag ||
        existing.size !== source.size ||
        existing.httpMetadata?.contentType !== type
      ) {
        return;
      }
    }
  } finally {
    if (!source.bodyUsed && !source.body.locked) await source.body.cancel().catch(() => {});
  }
  await env.DB.prepare(`UPDATE public_cover_replicas SET phase = 'ready'
    WHERE project_id = ? AND object_key = ? AND phase = 'copying'`)
    .bind(projectId, asset.object_key)
    .run();
}

// False means an unconditional reservation is still in flight or uncertain.
// The D1 guard also rejects any mutation that races a new generation.
export async function withdrawPublicCover(env: ReplicaEnv, projectId: string): Promise<boolean> {
  const bucket = env.PUBLIC_COVERS;
  if (!bucket) return true;
  const replica = await env.DB.prepare(`UPDATE public_cover_replicas SET phase = 'withdrawing'
    WHERE project_id = ? AND phase <> 'reserving' RETURNING object_key`)
    .bind(projectId)
    .first<{ object_key: string }>();
  if (!replica) {
    const pending = await env.DB.prepare("SELECT 1 FROM public_cover_replicas WHERE project_id = ?")
      .bind(projectId)
      .first();
    return !pending;
  }
  await deleteCoverReplica(bucket, replica.object_key);
  await env.DB.prepare(`DELETE FROM public_cover_replicas
    WHERE project_id = ? AND object_key = ? AND phase = 'withdrawing'`)
    .bind(projectId, replica.object_key)
    .run();
  return true;
}
