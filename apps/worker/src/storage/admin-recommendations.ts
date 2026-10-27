export async function updateAdminRecommendation(
  db: D1Database,
  projectId: string,
  actorId: string,
  update: { comment?: string; reaction?: string },
) {
  const project = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first<{ id: string }>();
  if (!project) return { kind: "not_found" as const };
  const existing = await db
    .prepare("SELECT comment, reaction FROM recommendations WHERE curator_id = ? AND project_id = ?")
    .bind(actorId, projectId)
    .first<{ comment: string; reaction: string }>();
  const comment = update.comment ?? existing?.comment ?? "";
  const reaction = update.reaction ?? existing?.reaction ?? "";
  const now = new Date().toISOString();
  const recommendationId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(`
      INSERT INTO recommendations (id, curator_id, project_id, comment, reaction, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(curator_id, project_id) DO UPDATE SET
        comment = excluded.comment, reaction = excluded.reaction, updated_at = excluded.updated_at
    `)
      .bind(recommendationId, actorId, projectId, comment, reaction, now, now),
    db
      .prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      VALUES (?, 'recommendation.update', 'project', ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        projectId,
        actorId,
        JSON.stringify({
          before: existing ? { comment: existing.comment, reaction: existing.reaction } : null,
          after: { comment, reaction },
        }),
        now,
      ),
  ]);
  const row = await db
    .prepare("SELECT id, comment, reaction FROM recommendations WHERE curator_id = ? AND project_id = ?")
    .bind(actorId, projectId)
    .first<{ id: string; comment: string; reaction: string }>();
  return { kind: "ok" as const, id: row?.id ?? recommendationId, comment, reaction };
}

export async function deleteAdminRecommendation(db: D1Database, projectId: string, actorId: string) {
  const existing = await db
    .prepare("SELECT id, comment, reaction FROM recommendations WHERE curator_id = ? AND project_id = ?")
    .bind(actorId, projectId)
    .first<{ id: string; comment: string; reaction: string }>();
  if (!existing) return { kind: "not_found" as const };
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM recommendations WHERE id = ?").bind(existing.id),
    db
      .prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      VALUES (?, 'recommendation.delete', 'project', ?, ?, ?, ?)
    `)
      .bind(crypto.randomUUID(), projectId, actorId, JSON.stringify({ before: existing }), now),
  ]);
  return { kind: "ok" as const };
}
