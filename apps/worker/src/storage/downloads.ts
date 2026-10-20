export type DownloadResult = "counted" | "duplicate" | "not_found";

export async function recordDownload(
  db: D1Database,
  projectId: string,
  userId: string,
): Promise<DownloadResult> {
  const project = await db.prepare(`
    SELECT 1 AS found FROM projects
    WHERE id = ? AND visibility = 'public' AND published_revision_id IS NOT NULL AND deleted_at IS NULL
  `).bind(projectId).first<{ found: number }>();
  if (!project) return "not_found";

  const dayKey = new Date().toISOString().slice(0, 10);
  const inserted = await db.prepare(`
    INSERT OR IGNORE INTO download_events (user_id, project_id, day_key)
    VALUES (?, ?, ?)
  `).bind(userId, projectId, dayKey).run();
  return inserted.meta.changes === 0 ? "duplicate" : "counted";
}
