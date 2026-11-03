import { projectEntryIndexDocumentSchema, recommendationRunResultSchema } from "@workshop/contracts";

async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Reports are untrusted sampled observations, not delivery or billing evidence. */
export async function recordRecommendationSignals(
  db: D1Database,
  userId: string,
  secret: string,
  input: { runId: string; visible: string[]; clicked: string[] },
) {
  const now = new Date().toISOString();
  const run = await db
    .prepare(
      "SELECT result FROM recommendation_runs WHERE id=? AND kind='discovery' AND status='complete' AND display_start_at<=? AND display_end_at>?",
    )
    .bind(input.runId, now, now)
    .first<{ result: string }>();
  if (!run) return { kind: "not_found" as const };
  const reporter = await digest(`${secret}\0${input.runId}\0${userId}`);
  if (Number.parseInt(reporter.slice(0, 2), 16) >= 16) return { kind: "ok" as const };
  const eligible = new Set(
    recommendationRunResultSchema.parse(JSON.parse(run.result)).items.map((item) => item.project_id),
  );
  const visible = [...new Set(input.visible)].filter((id) => eligible.has(id));
  const clicked = [...new Set(input.clicked)].filter((id) => visible.includes(id));
  if (!visible.length) return { kind: "ok" as const };
  await db
    .prepare(`INSERT INTO recommendation_signals(reporter_hash,run_id,visible_projects,clicked_projects,writes,updated_at)
    VALUES(?,?,?,?,1,?) ON CONFLICT(reporter_hash,run_id) DO UPDATE SET
    visible_projects=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(recommendation_signals.visible_projects) UNION SELECT value FROM json_each(excluded.visible_projects))),
    clicked_projects=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(recommendation_signals.clicked_projects) UNION SELECT value FROM json_each(excluded.clicked_projects))),
    writes=recommendation_signals.writes+1,updated_at=excluded.updated_at WHERE recommendation_signals.writes<4`)
    .bind(reporter, input.runId, JSON.stringify(visible), JSON.stringify(clicked), now)
    .run();
  return { kind: "ok" as const };
}

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
