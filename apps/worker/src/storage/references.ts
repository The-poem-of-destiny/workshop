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

const SELECT_REFERENCES = `
  SELECT s.id, s.name, s.description,
         v.id AS version_id, v.version_label, v.version_ordinal, v.grace_until,
         SUM(CASE WHEN i.kind = 'worldbook' THEN 1 ELSE 0 END) AS worldbook_count,
         SUM(CASE WHEN i.kind = 'regex' THEN 1 ELSE 0 END) AS regex_count
  FROM reference_sets s
  JOIN reference_versions v ON v.reference_set_id = s.id
  LEFT JOIN reference_items i ON i.reference_version_id = v.id
`;

async function hydrateReferenceRows(db: D1Database, rows: ReferenceRow[]): Promise<ReferenceSet[]> {
  const versionIds = [...new Set(rows.map((row) => row.version_id))];
  const itemRows =
    versionIds.length === 0
      ? null
      : await db
          .prepare(`
    SELECT id, reference_version_id, kind, display_name, exact_hash,
           normalized_content_hash, name_hash, structure_hash
    FROM reference_items
    WHERE reference_version_id IN (${versionIds.map(() => "?").join(", ")})
    ORDER BY kind, display_name
  `)
          .bind(...versionIds)
          .all<{
            id: string;
            reference_version_id: string;
            kind: "worldbook" | "regex";
            display_name: string;
            exact_hash: string;
            normalized_content_hash: string;
            name_hash: string;
            structure_hash: string;
          }>();
  const itemsByVersion = new Map<string, ReferenceSet["versions"][number]["items"]>();
  for (const item of itemRows?.results ?? []) {
    const list = itemsByVersion.get(item.reference_version_id) ?? [];
    list.push({
      id: item.id,
      kind: item.kind,
      displayName: item.display_name,
      exactHash: item.exact_hash,
      normalizedContentHash: item.normalized_content_hash,
      nameHash: item.name_hash,
      structureHash: item.structure_hash,
    });
    itemsByVersion.set(item.reference_version_id, list);
  }

  const sets = new Map<string, ReferenceSet>();
  for (const row of rows) {
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
      items: itemsByVersion.get(row.version_id) ?? [],
    });
  }
  return [...sets.values()];
}

export async function listReferenceSets(db: D1Database): Promise<ReferenceSet[]> {
  const rows = await db
    .prepare(`${SELECT_REFERENCES} GROUP BY s.id, v.id ORDER BY s.name, v.version_ordinal DESC`)
    .all<ReferenceRow>();
  return hydrateReferenceRows(db, rows.results);
}

export async function getReferenceSet(db: D1Database, id: string): Promise<ReferenceSet | null> {
  const rows = await db
    .prepare(`${SELECT_REFERENCES} WHERE s.id = ? GROUP BY s.id, v.id ORDER BY v.version_ordinal DESC`)
    .bind(id)
    .all<ReferenceRow>();
  const [set] = await hydrateReferenceRows(db, rows.results);
  return set ?? null;
}
