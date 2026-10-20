import type { Session } from "@workshop/contracts";

interface ReleaseRow {
  revision_id: string;
  manifest_hash: string | null;
  kind: string;
  r2_key: string;
  sha256: string;
  bytes: number;
  mime: string;
}

export async function getReleaseAssets(
  db: D1Database,
  projectId: string,
  revisionId: string,
  session: Session,
) {
  const rows = await db.prepare(`
    SELECT r.id AS revision_id, r.manifest_hash,
           a.kind, a.r2_key, a.sha256, a.bytes, a.mime
    FROM projects p
    JOIN project_revisions r ON r.id = p.published_revision_id
    JOIN assets a ON a.revision_id = r.id
    WHERE p.id = ?
      AND p.published_revision_id = ?
      AND p.deleted_at IS NULL
      AND (p.visibility = 'public' OR p.author_id = ? OR ? IN ('reviewer', 'owner'))
      AND a.kind IN ('worldbook', 'regex')
    ORDER BY a.kind
  `).bind(projectId, revisionId, session.userId, session.role).all<ReleaseRow>();

  if (rows.results.length === 0) return null;
  const first = rows.results[0]!;
  return {
    revisionId: first.revision_id,
    manifestHash: first.manifest_hash,
    files: rows.results.map(row => ({
      kind: row.kind as "worldbook" | "regex",
      sha256: row.sha256,
      bytes: row.bytes,
      mime: row.mime,
      r2Key: row.r2_key,
    })),
  };
}
