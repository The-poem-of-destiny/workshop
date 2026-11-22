import { type Banner, type JsonValue, jsonValueSchema, serializeAuditDetail } from "@workshop/contracts";
import { type BannerState, bannerSourceUrl } from "./home.js";

export async function updateAdminSite(
  db: D1Database,
  actorId: string,
  bannerChange: { banner: Banner; current: BannerState | null } | undefined,
  siteContent: unknown,
) {
  const banner = bannerChange?.banner;
  const current = await db
    .prepare(`
    SELECT key, value FROM site_settings WHERE key IN ('discover_banner', 'site_content')
  `)
    .all<{ key: string; value: string }>();
  const before: Record<string, JsonValue> = {};
  for (const row of current.results) {
    try {
      before[row.key] = jsonValueSchema.parse(JSON.parse(row.value));
    } catch {
      before[row.key] = row.value;
    }
  }
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const revision = bannerChange ? crypto.randomUUID() : null;
  const committed = "EXISTS (SELECT 1 FROM site_settings WHERE key = 'discover_banner' AND banner_revision = ?)";
  if (bannerChange) {
    const { current, banner } = bannerChange;
    statements.push(
      db
        .prepare(`
      INSERT INTO site_settings (key, value, updated_at, updated_by, banner_revision)
      SELECT 'discover_banner', ?, ?, ?, ?
      WHERE (SELECT value FROM site_settings WHERE key = 'discover_banner') IS ?
        AND (SELECT banner_revision FROM site_settings WHERE key = 'discover_banner') IS ?
        AND (? IS ? OR NOT EXISTS (SELECT 1 FROM public_banner_replicas WHERE id = 1))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
        updated_by = excluded.updated_by, banner_revision = excluded.banner_revision
    `)
        .bind(
          JSON.stringify(banner),
          now,
          actorId,
          revision,
          current?.value ?? null,
          current?.banner_revision ?? null,
          banner.imageUrl,
          bannerSourceUrl(current),
        ),
    );
  }
  if (siteContent !== undefined) {
    statements.push(
      db
        .prepare(`
      INSERT INTO site_settings (key, value, updated_at, updated_by)
      SELECT 'site_content', ?, ?, ? WHERE ? IS NULL OR ${committed}
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `)
        .bind(JSON.stringify(siteContent), now, actorId, revision, revision),
    );
  }
  const after = {
    ...(banner === undefined ? {} : { discover_banner: banner }),
    ...(siteContent === undefined ? {} : { site_content: jsonValueSchema.parse(siteContent) }),
  };
  statements.push(
    db
      .prepare(`
    INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
    SELECT ?, 'site.update', 'site', 'site', ?, ?, ? WHERE ? IS NULL OR ${committed}
  `)
      .bind(
        crypto.randomUUID(),
        actorId,
        serializeAuditDetail("site.update", { before, after }),
        now,
        revision,
        revision,
      ),
  );
  const [result] = await db.batch(statements);
  if (bannerChange && result?.meta.changes !== 1) return null;
  return { banner, siteContent };
}
