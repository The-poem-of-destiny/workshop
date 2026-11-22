import initial from "../../migrations/0001_initial.sql?raw";
import publicCoverReplicas from "../../migrations/0002_public_cover_replicas.sql?raw";
import publicGalleryReplicas from "../../migrations/0003_public_gallery_replicas.sql?raw";
import publicBannerReplicas from "../../migrations/0004_public_banner_replicas.sql?raw";
import { splitSql } from "./sql";

export async function applySchema(db: D1Database): Promise<void> {
  for (const source of [initial, publicCoverReplicas, publicGalleryReplicas, publicBannerReplicas]) {
    const sql = source.replace(/^\s*--.*$/gm, "").replace(/^\s*PRAGMA\b.*$/gm, "");
    for (const statement of splitSql(sql)) await db.prepare(statement).run();
  }
}
