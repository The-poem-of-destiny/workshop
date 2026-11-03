import type { Session } from "@workshop/contracts";

interface ReleaseRow {
  version_id: string;
  manifest_hash: string | null;
  kind: string;
  r2_key: string;
  sha256: string;
  bytes: number;
  mime: string;
}

export async function getReleaseAssets(db: D1Database, projectId: string, versionId: string | null, session: Session) {
  const rows = await db
    .prepare(`
    SELECT r.id AS version_id, r.manifest_hash,
           a.kind, a.r2_key, a.sha256, a.bytes, a.mime
    FROM projects p
    JOIN project_versions r ON r.id = p.published_version_id
    JOIN assets a ON a.version_id = r.id
    WHERE p.id = ?
      AND (? IS NULL OR p.published_version_id = ?)
      AND p.deleted_at IS NULL
      AND (p.visibility = 'public' OR p.author_id = ? OR ? IN ('reviewer', 'owner'))
      AND a.kind IN ('worldbook', 'regex')
    ORDER BY a.kind
  `)
    .bind(projectId, versionId, versionId, session.userId, session.role)
    .all<ReleaseRow>();

  if (rows.results.length === 0) return null;
  const first = rows.results[0]!;
  return {
    versionId: first.version_id,
    manifestHash: first.manifest_hash,
    files: rows.results.map((row) => ({
      kind: row.kind as "worldbook" | "regex",
      sha256: row.sha256,
      bytes: row.bytes,
      mime: row.mime,
      r2Key: row.r2_key,
    })),
  };
}
