import type { AdminReferenceSetCreate, AdminReferenceVersionCreate } from "@workshop/contracts";

export async function updateAdminReferenceSet(
  db: D1Database,
  id: string,
  actorId: string,
  update: {
    name?: string;
    description?: string | null;
    versionLabel?: string;
    items?: Array<{
      kind: "worldbook" | "regex";
      displayName: string;
      sourceKey?: string | null;
      exactHash?: string;
      normalizedContentHash?: string;
      nameHash?: string;
      keysHash?: string | null;
      structureHash?: string;
    }>;
  },
) {
  const target = await db
    .prepare(`
    SELECT s.name, s.description, v.id AS version_id, v.version_label
    FROM reference_sets s
    JOIN reference_versions v ON v.reference_set_id = s.id
    WHERE s.id = ?
    ORDER BY v.version_ordinal DESC LIMIT 1
  `)
    .bind(id)
    .first<{ name: string; description: string | null; version_id: string; version_label: string }>();
  if (!target) return { kind: "not_found" as const };
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db
      .prepare("UPDATE reference_sets SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .bind(
        update.name ?? target.name,
        update.description === undefined ? target.description : update.description,
        now,
        id,
      ),
    db
      .prepare("UPDATE reference_versions SET version_label = ? WHERE id = ?")
      .bind(update.versionLabel ?? target.version_label, target.version_id),
  ];
  if (update.items !== undefined) {
    statements.push(db.prepare("DELETE FROM reference_items WHERE reference_version_id = ?").bind(target.version_id));
    for (const item of update.items) {
      statements.push(
        db
          .prepare(`
        INSERT INTO reference_items
          (id, reference_version_id, kind, source_key, display_name, exact_hash,
           normalized_content_hash, name_hash, keys_hash, structure_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
          .bind(
            crypto.randomUUID(),
            target.version_id,
            item.kind,
            item.sourceKey ?? null,
            item.displayName,
            item.exactHash ?? "",
            item.normalizedContentHash ?? "",
            item.nameHash ?? "",
            item.keysHash ?? null,
            item.structureHash ?? "",
            now,
          ),
      );
    }
  }
  statements.push(
    db
      .prepare(`
    INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
    VALUES (?, 'reference_set.update', 'reference_set', ?, ?, ?, ?)
  `)
      .bind(
        crypto.randomUUID(),
        id,
        actorId,
        JSON.stringify({
          before: { name: target.name, description: target.description, versionLabel: target.version_label },
          after: update,
        }),
        now,
      ),
  );
  await db.batch(statements);
  return { kind: "ok" as const };
}

function referenceItemStatements(
  db: D1Database,
  versionId: string,
  items: AdminReferenceSetCreate["items"] | AdminReferenceVersionCreate["items"],
  now: string,
): D1PreparedStatement[] {
  return items.map((item) =>
    db
      .prepare(`
    INSERT INTO reference_items
      (id, reference_version_id, kind, source_key, display_name, exact_hash,
       normalized_content_hash, name_hash, keys_hash, structure_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
      .bind(
        crypto.randomUUID(),
        versionId,
        item.kind,
        item.sourceKey ?? null,
        item.displayName,
        item.exactHash ?? "",
        item.normalizedContentHash ?? "",
        item.nameHash ?? "",
        item.keysHash ?? null,
        item.structureHash ?? "",
        now,
      ),
  );
}

export async function createAdminReferenceSet(db: D1Database, actorId: string, input: AdminReferenceSetCreate) {
  const now = new Date().toISOString();
  const setId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO reference_sets (id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(setId, input.name, input.description ?? null, actorId, now, now),
    db
      .prepare(`INSERT INTO reference_versions
      (id, reference_set_id, version_label, version_ordinal, grace_until, created_by, created_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)`)
      .bind(versionId, setId, input.versionLabel, input.graceUntil ?? "9999-12-31T00:00:00.000Z", actorId, now),
    ...referenceItemStatements(db, versionId, input.items, now),
    db
      .prepare(`INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      VALUES (?, 'reference_set.create', 'reference_set', ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        setId,
        actorId,
        JSON.stringify({ name: input.name, versionLabel: input.versionLabel, items: input.items.length }),
        now,
      ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) return { kind: "conflict" as const };
    throw error;
  }
  return { kind: "ok" as const, id: setId, versionId };
}

export async function createAdminReferenceVersion(
  db: D1Database,
  actorId: string,
  setId: string,
  input: AdminReferenceVersionCreate,
) {
  const set = await db.prepare("SELECT id FROM reference_sets WHERE id = ?").bind(setId).first<{ id: string }>();
  if (!set) return { kind: "not_found" as const };
  const latest = await db
    .prepare("SELECT MAX(version_ordinal) AS ordinal FROM reference_versions WHERE reference_set_id = ?")
    .bind(setId)
    .first<{ ordinal: number | null }>();
  const now = new Date().toISOString();
  const versionId = crypto.randomUUID();
  const ordinal = (latest?.ordinal ?? 0) + 1;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(`INSERT INTO reference_versions
      (id, reference_set_id, version_label, version_ordinal, grace_until, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        versionId,
        setId,
        input.versionLabel,
        ordinal,
        input.graceUntil ?? "9999-12-31T00:00:00.000Z",
        actorId,
        now,
      ),
    ...referenceItemStatements(db, versionId, input.items, now),
    db
      .prepare(`INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      VALUES (?, 'reference_version.create', 'reference_set', ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        setId,
        actorId,
        JSON.stringify({ versionLabel: input.versionLabel, ordinal, items: input.items.length }),
        now,
      ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) return { kind: "conflict" as const };
    throw error;
  }
  return { kind: "ok" as const, id: versionId, ordinal };
}
