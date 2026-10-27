export async function updateAdminSite(
  db: D1Database,
  actorId: string,
  banner:
    | {
        imageUrl: string | null;
        positionX: number;
        positionY: number;
        zoom: number;
        mobilePositionX: number;
        mobilePositionY: number;
        mobileZoom: number;
      }
    | undefined,
  siteContent: unknown,
) {
  const current = await db
    .prepare(`
    SELECT key, value FROM site_settings WHERE key IN ('discover_banner', 'site_content')
  `)
    .all<{ key: string; value: string }>();
  const before: Record<string, unknown> = {};
  for (const row of current.results) {
    try {
      before[row.key] = JSON.parse(row.value) as unknown;
    } catch {
      before[row.key] = row.value;
    }
  }
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (banner !== undefined) {
    statements.push(
      db
        .prepare(`
      INSERT INTO site_settings (key, value, updated_at, updated_by) VALUES ('discover_banner', ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `)
        .bind(JSON.stringify(banner), now, actorId),
    );
  }
  if (siteContent !== undefined) {
    statements.push(
      db
        .prepare(`
      INSERT INTO site_settings (key, value, updated_at, updated_by) VALUES ('site_content', ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `)
        .bind(JSON.stringify(siteContent), now, actorId),
    );
  }
  const after = {
    ...(banner === undefined ? {} : { discover_banner: banner }),
    ...(siteContent === undefined ? {} : { site_content: siteContent }),
  };
  statements.push(
    db
      .prepare(`
    INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
    VALUES (?, 'site.update', 'site', 'site', ?, ?, ?)
  `)
      .bind(crypto.randomUUID(), actorId, JSON.stringify({ before, after }), now),
  );
  await db.batch(statements);
  return { banner, siteContent };
}
