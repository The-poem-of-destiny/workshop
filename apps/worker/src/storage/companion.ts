import {
  type CompanionVersionInput,
  type CompanionVersionRecord,
  companionVersionRecordSchema,
} from "@workshop/contracts";

export async function getCompanionVersion(
  db: D1Database,
  scriptId: string,
  version?: string,
): Promise<CompanionVersionRecord | null> {
  const key = version === undefined ? `companion:latest:${scriptId}` : `companion:version:${scriptId}:${version}`;
  const row = await db.prepare("SELECT value FROM site_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? companionVersionRecordSchema.parse(JSON.parse(row.value)) : null;
}

export async function publishCompanionVersion(
  db: D1Database,
  actorId: string,
  scriptId: string,
  version: string,
  input: CompanionVersionInput,
): Promise<{ status: "created" | "existing" | "conflict"; record: CompanionVersionRecord }> {
  const record: CompanionVersionRecord = {
    ...input,
    scriptId,
    version,
    releaseId: crypto.randomUUID(),
    publishedAt: new Date().toISOString(),
  };
  const key = `companion:version:${scriptId}:${version}`;
  const value = JSON.stringify(record);
  // The exact record's unique releaseId guards both effects in the same D1
  // transaction. Replays (including concurrent ones) never move latest backwards.
  await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO site_settings (key, value, updated_at, updated_by)
      VALUES (?, ?, ?, ?)`)
      .bind(key, value, record.publishedAt, actorId),
    db
      .prepare(`INSERT INTO site_settings (key, value, updated_at, updated_by)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM site_settings WHERE key = ? AND value = ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
        updated_by = excluded.updated_by`)
      .bind(`companion:latest:${scriptId}`, value, record.publishedAt, actorId, key, value),
    db
      .prepare(`INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      SELECT ?, 'companion.publish', 'companion_script', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM site_settings WHERE key = ? AND value = ?)`)
      .bind(record.releaseId, scriptId, actorId, JSON.stringify({ version }), record.publishedAt, key, value),
  ]);
  const stored = await getCompanionVersion(db, scriptId, version);
  if (!stored) throw new Error("Companion version registration missing after transaction");
  const status =
    stored.releaseId === record.releaseId
      ? "created"
      : stored.displayName === input.displayName && stored.downloadUrl === input.downloadUrl
        ? "existing"
        : "conflict";
  return { status, record: stored };
}
