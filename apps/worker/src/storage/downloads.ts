import type { AuthenticatedSession } from "./sessions";

export function releaseDownloads(
  projectId: string,
  versionId: string,
  files: ReadonlyArray<{ kind: "worldbook" | "regex" }>,
) {
  return files.map(({ kind }) => ({
    kind,
    url: `/api/v1/downloads/${encodeURIComponent(projectId)}/${encodeURIComponent(versionId)}/${kind}`,
  }));
}

/** One caller-generated UUID per logical acquisition; retries reuse it, file GETs never count.
 * At most 128 distinct acquisitions per user/version/UTC day bounds deduplication storage.
 * Authorization and publication are rechecked in the same SQL statement as accounting.
 */
export async function recordAcquisition(
  db: D1Database,
  session: AuthenticatedSession,
  projectId: string,
  versionId: string,
  acquisitionId: string,
): Promise<"ok" | "not_found" | "rate_limited"> {
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const result = await db
    .prepare(`
    INSERT INTO download_daily_stats(user_id,project_id,project_version_id,day_key,count,first_downloaded_at,last_downloaded_at,acquisition_ids)
    SELECT ?,p.id,?,?,1,?,?,json_array(?) FROM projects p
    JOIN users u ON u.id = ?
    WHERE p.id = ? AND p.published_version_id = ? AND p.deleted_at IS NULL
      AND (p.visibility = 'public' OR p.author_id = u.id OR u.role IN ('reviewer','owner'))
      AND EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash = ? AND s.user_id = u.id
        AND s.session_version = ? AND s.revoked_at IS NULL AND s.expires_at > ?)
      AND NOT EXISTS(SELECT 1 FROM download_daily_stats previous, json_each(previous.acquisition_ids) ids
        WHERE previous.user_id = u.id AND previous.project_id = p.id AND ids.value = ?)
    ON CONFLICT(user_id,project_version_id,day_key) DO UPDATE SET
      count = count + 1, last_downloaded_at = excluded.last_downloaded_at,
      acquisition_ids = json_insert(acquisition_ids,'$[#]',json_extract(excluded.acquisition_ids,'$[0]'))
    WHERE count < 128 AND NOT EXISTS(SELECT 1 FROM json_each(acquisition_ids)
      WHERE value = json_extract(excluded.acquisition_ids,'$[0]'))
  `)
    .bind(
      session.userId,
      versionId,
      day,
      now,
      now,
      acquisitionId,
      session.userId,
      projectId,
      versionId,
      session.tokenHash,
      session.sessionVersion,
      now,
      acquisitionId,
    )
    .run();
  if ((result.meta.changes ?? 0) > 0) return "ok";
  const replay = await db
    .prepare(`SELECT 1 AS found FROM download_daily_stats d, json_each(d.acquisition_ids) ids
    JOIN projects p ON p.id = d.project_id JOIN users u ON u.id = d.user_id
    JOIN sessions s ON s.user_id = u.id AND s.token_hash = ?
    WHERE d.user_id = ? AND d.project_id = ? AND ids.value = ?
      AND p.deleted_at IS NULL AND p.published_version_id = ?
      AND (p.visibility = 'public' OR p.author_id = u.id OR u.role IN ('reviewer','owner'))
      AND s.revoked_at IS NULL AND s.session_version = ? AND s.expires_at > ?`)
    .bind(session.tokenHash, session.userId, projectId, acquisitionId, versionId, session.sessionVersion, now)
    .first();
  if (replay) return "ok";
  const row = await db
    .prepare(`SELECT count FROM download_daily_stats WHERE user_id = ? AND project_version_id = ? AND day_key = ?`)
    .bind(session.userId, versionId, day)
    .first<{ count: number }>();
  return row ? "rate_limited" : "not_found";
}
