import {
  type BannerState,
  bannerSourceKey,
  bannerSourceUrl,
  publicBannerPrefix,
  readBannerState,
} from "../storage/home.js";
import { deleteCoverReplica, reserveCoverReplica } from "./cover-replica.js";

interface ReplicaEnv {
  DB: D1Database;
  R2: R2Bucket;
  PUBLIC_COVERS?: R2Bucket;
  PUBLIC_ASSETS_BASE_URL?: string;
  PUBLIC_ORIGIN?: string;
}

export async function replicatePublicBanner(env: ReplicaEnv, expectedSourceUrl?: string): Promise<void> {
  const bucket = env.PUBLIC_COVERS;
  if (!bucket || !env.PUBLIC_ASSETS_BASE_URL) return;
  const current = await readBannerState(env.DB);
  if (!current || (current.phase && current.phase !== "copying")) return;
  const sourceUrl = bannerSourceUrl(current);
  if (!sourceUrl || (expectedSourceUrl !== undefined && sourceUrl !== expectedSourceUrl)) return;
  const sourceKey = bannerSourceKey(sourceUrl, env.PUBLIC_ORIGIN);
  if (!sourceKey) return;
  const source = await env.R2.get(sourceKey);
  if (!source) return;
  try {
    const contentType = source.httpMetadata?.contentType;
    if (contentType !== "image/png" && contentType !== "image/jpeg" && contentType !== "image/webp") return;
    let key = current.object_key;
    let reservationEtag = current.reservation_etag;
    if (!key) {
      key = `${publicBannerPrefix}${crypto.randomUUID()}`;
      const candidate = await env.DB.prepare(`INSERT INTO public_banner_replicas (id, source_url, object_key, phase)
        SELECT 1, ?, ?, 'reserving' FROM site_settings
        WHERE key = 'discover_banner' AND value = ? AND banner_revision IS ?
        ON CONFLICT(id) DO NOTHING RETURNING id`)
        .bind(sourceUrl, key, current.value, current.banner_revision)
        .first();
      if (!candidate) return;

      const reservation = await reserveCoverReplica(bucket, key);
      if (!reservation) throw new Error("Public banner reservation collision");
      reservationEtag = reservation.etag;
      const copying = await env.DB.prepare(`UPDATE public_banner_replicas SET phase = 'copying', reservation_etag = ?
        WHERE id = 1 AND object_key = ? AND phase = 'reserving' RETURNING id`)
        .bind(reservationEtag, key)
        .first();
      if (!copying) return;
    }
    if (!reservationEtag) return;

    const copy = await bucket.put(key, source.body, {
      onlyIf: { etagMatches: reservationEtag },
      httpMetadata: { contentType, cacheControl: "public, max-age=0, must-revalidate" },
      customMetadata: { sourceEtag: source.etag },
    });
    if (!copy) {
      // A previous PUT may have succeeded without advancing the D1 phase.
      const existing = await bucket.head(key);
      if (
        existing?.size !== source.size ||
        existing.httpMetadata?.contentType !== contentType ||
        existing.customMetadata?.sourceEtag !== source.etag
      )
        return;
    }
    await env.DB.prepare(`UPDATE public_banner_replicas SET phase = 'ready'
      WHERE id = 1 AND object_key = ? AND phase = 'copying'`)
      .bind(key)
      .run();
  } finally {
    if (!source.body.locked) await source.body.cancel();
  }
}

// Only a confirmed reservation can be withdrawn. A late image copy can never
// recreate the deleted key because its PUT requires that reservation's ETag.
export async function withdrawPublicBanner(env: ReplicaEnv, current: BannerState | null): Promise<boolean> {
  if (!current?.object_key) return true;
  const bucket = env.PUBLIC_COVERS;
  if (!bucket) return false;
  const replica = await env.DB.prepare(`UPDATE public_banner_replicas SET phase = 'withdrawing'
    WHERE id = 1 AND object_key = ? AND phase <> 'reserving'
      AND EXISTS (SELECT 1 FROM site_settings WHERE key = 'discover_banner' AND value = ? AND banner_revision IS ?)
    RETURNING object_key`)
    .bind(current.object_key, current.value, current.banner_revision)
    .first<{ object_key: string }>();
  if (!replica) return false;
  await deleteCoverReplica(bucket, replica.object_key);
  await env.DB.prepare(`DELETE FROM public_banner_replicas
    WHERE id = 1 AND object_key = ? AND phase = 'withdrawing'`)
    .bind(replica.object_key)
    .run();
  return true;
}
