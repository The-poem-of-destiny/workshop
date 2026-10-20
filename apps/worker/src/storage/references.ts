import type { ReferenceSet } from "@workshop/contracts";

interface ReferenceRow {
  id: string;
  name: string;
  description: string | null;
  version_id: string;
  version_label: string;
  version_ordinal: number;
  grace_until: string;
  worldbook_count: number;
  regex_count: number;
}

export async function listReferenceSets(db: D1Database): Promise<ReferenceSet[]> {
  const rows = await db.prepare(`
    SELECT s.id, s.name, s.description,
           v.id AS version_id, v.version_label, v.version_ordinal, v.grace_until,
           SUM(CASE WHEN i.kind = 'worldbook' THEN 1 ELSE 0 END) AS worldbook_count,
           SUM(CASE WHEN i.kind = 'regex' THEN 1 ELSE 0 END) AS regex_count
    FROM reference_sets s
    JOIN reference_versions v ON v.reference_set_id = s.id
    LEFT JOIN reference_items i ON i.reference_version_id = v.id
    GROUP BY s.id, v.id
    ORDER BY s.name, v.version_ordinal DESC
  `).all<ReferenceRow>();

  const sets = new Map<string, ReferenceSet>();
  for (const row of rows.results) {
    let set = sets.get(row.id);
    if (!set) {
      set = {
        id: row.id,
        name: row.name,
        description: row.description,
        versions: [],
      };
      sets.set(row.id, set);
    }
    set.versions.push({
      id: row.version_id,
      label: row.version_label,
      ordinal: row.version_ordinal,
      graceUntil: row.grace_until,
      worldbookCount: row.worldbook_count,
      regexCount: row.regex_count,
    });
  }
  return [...sets.values()];
}
