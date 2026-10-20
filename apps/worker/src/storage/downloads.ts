export async function recordDownload(db: D1Database, projectId: string): Promise<boolean> {
  const project = await db.prepare(`
    SELECT 1 AS found FROM projects
    WHERE id = ? AND visibility = 'public' AND published_revision_id IS NOT NULL AND deleted_at IS NULL
  `).bind(projectId).first<{ found: number }>();
  if (!project) return false;

  const dayKey = new Date().toISOString().slice(0, 10);
  await db.batch([
    db.prepare("UPDATE projects SET downloads_count = downloads_count + 1 WHERE id = ?").bind(projectId),
    db.prepare(`
      INSERT INTO project_metrics_daily (day_key, project_id, downloads)
      VALUES (?, ?, 1)
      ON CONFLICT(day_key, project_id) DO UPDATE SET downloads = downloads + 1
    `).bind(dayKey, projectId),
  ]);
  return true;
}
