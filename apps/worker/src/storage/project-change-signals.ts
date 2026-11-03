import { projectEntryIndexDocumentSchema } from "@workshop/contracts";

/** A bounded hint tied to exact immutable content manifests; metadata-only changes earn nothing. */
export async function recordProjectChange(
  db: D1Database,
  userId: string,
  input: {
    projectId: string;
    projectVersionId: string;
    previousVersionId: string;
    previousManifestHash: string;
    currentManifestHash: string;
    changedEntries: number;
    totalEntries: number;
  },
) {
  const current = await db
    .prepare(`SELECT v.entry_index,v.created_at FROM project_versions v JOIN projects p ON p.id=v.project_id
    WHERE p.id=? AND p.author_id=? AND p.working_version_id=v.id AND v.id=? AND v.manifest_hash=?
    AND EXISTS(SELECT 1 FROM project_versions old WHERE old.project_id=p.id AND old.id=? AND old.manifest_hash=?)
    AND NOT EXISTS(SELECT 1 FROM project_change_signals s WHERE s.project_id=p.id AND julianday(s.reported_at)>julianday('now','-1 day'))`)
    .bind(
      input.projectId,
      userId,
      input.projectVersionId,
      input.currentManifestHash,
      input.previousVersionId,
      input.previousManifestHash,
    )
    .first<{ entry_index: string | null; created_at: string }>();
  if (!current || input.previousManifestHash === input.currentManifestHash) return { kind: "not_found" as const };
  // The server only checks bounded index evidence; client magnitudes are never authoritative.
  const rows = await db
    .prepare("SELECT id,entry_index FROM project_versions WHERE project_id=? AND id IN (?,?)")
    .bind(input.projectId, input.projectVersionId, input.previousVersionId)
    .all<{ id: string; entry_index: string | null }>();
  const old = rows.results.find((row) => row.id === input.previousVersionId);
  if (!current.entry_index || !old?.entry_index) return { kind: "not_found" as const };
  const entries = (text: string) => projectEntryIndexDocumentSchema.parse(JSON.parse(text)).entries;
  const before = new Map(entries(old.entry_index).map((e) => [`${e.kind}:${e.entryKey}`, e.contentHash]));
  const after = new Map(entries(current.entry_index).map((e) => [`${e.kind}:${e.entryKey}`, e.contentHash]));
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changed = [...keys].filter((key) => before.get(key) !== after.get(key)).length;
  if (!changed || input.changedEntries !== changed || input.totalEntries !== keys.size)
    return { kind: "not_found" as const };
  const result = await db
    .prepare(`INSERT INTO project_change_signals(project_id,project_version_id,previous_version_id,previous_manifest_hash,current_manifest_hash,changed_entries,total_entries,reported_at)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects p JOIN project_versions v ON v.id=p.working_version_id
      WHERE p.id=? AND p.author_id=? AND v.id=? AND v.manifest_hash=? AND p.deleted_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM project_change_signals s WHERE s.project_id=? AND julianday(s.reported_at)>julianday('now','-1 day'))
    ON CONFLICT(project_version_id) DO NOTHING`)
    .bind(
      input.projectId,
      input.projectVersionId,
      input.previousVersionId,
      input.previousManifestHash,
      input.currentManifestHash,
      input.changedEntries,
      input.totalEntries,
      new Date().toISOString(),
      input.projectId,
      userId,
      input.projectVersionId,
      input.currentManifestHash,
      input.projectId,
    )
    .run();
  return result.meta.changes ? { kind: "ok" as const } : { kind: "not_found" as const };
}
