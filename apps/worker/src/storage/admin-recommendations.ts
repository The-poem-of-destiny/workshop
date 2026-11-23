export async function updateAdminRecommendation(
  db: D1Database,
  projectId: string,
  actorId: string,
  update: { projectVersionId: string; comment?: string },
  requireSubscription: boolean,
) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const qualification = requireSubscription
    ? " AND EXISTS (SELECT 1 FROM project_subscriptions s WHERE s.project_id=p.id AND s.user_id=u.id)"
    : "";
  const results = await db.batch([
    db
      .prepare(`INSERT INTO audit_events(id,action,target_type,target_id,actor_id,detail,created_at)
      SELECT ?, 'recommendation.update', 'project', p.id, u.id,
        json_object('before',json((SELECT json_object('projectVersionId',project_version_id,'comment',comment)
          FROM recommendations WHERE curator_id=u.id AND project_version_id=?)),
          'after',json_object('projectVersionId',?,'comment',COALESCE(?,
            (SELECT comment FROM recommendations WHERE curator_id=u.id AND project_version_id=?),''))), ?
      FROM projects p JOIN users u ON u.id=?
      WHERE p.id=? AND p.published_version_id=? AND p.visibility='public' AND p.deleted_at IS NULL${qualification}`)
      .bind(
        crypto.randomUUID(),
        update.projectVersionId,
        update.projectVersionId,
        update.comment ?? null,
        update.projectVersionId,
        now,
        actorId,
        projectId,
        update.projectVersionId,
      ),
    db
      .prepare(`INSERT INTO recommendations(id,curator_id,project_id,project_version_id,comment,created_at,updated_at)
    SELECT ?,?,?,?, COALESCE(?,(SELECT comment FROM recommendations WHERE curator_id=? AND project_version_id=?),''),?,? FROM projects p JOIN users u ON u.id=?
    WHERE p.id=? AND p.published_version_id=? AND p.visibility='public' AND p.deleted_at IS NULL${qualification}
    ON CONFLICT(curator_id,project_version_id) DO UPDATE SET comment=excluded.comment,
      updated_at=CASE WHEN recommendations.comment=excluded.comment THEN recommendations.updated_at ELSE excluded.updated_at END`)
      .bind(
        id,
        actorId,
        projectId,
        update.projectVersionId,
        update.comment ?? null,
        actorId,
        update.projectVersionId,
        now,
        now,
        actorId,
        projectId,
        update.projectVersionId,
      ),
    db
      .prepare(`SELECT r.id,r.comment,
        EXISTS (SELECT 1 FROM project_subscriptions s WHERE s.project_id=p.id AND s.user_id=?) AS eligible
        FROM projects p LEFT JOIN recommendations r ON r.curator_id=? AND r.project_version_id=p.published_version_id
        WHERE p.id=? AND p.published_version_id=? AND p.visibility='public' AND p.deleted_at IS NULL`)
      .bind(actorId, actorId, projectId, update.projectVersionId),
  ]);
  const row = results[2]!.results[0] as { id: string | null; comment: string | null; eligible: number } | undefined;
  if (!row) return { kind: "not_found" as const };
  if (requireSubscription && !row.eligible) return { kind: "forbidden" as const };
  if (!results[1]!.meta.changes || !row.id) throw new Error("Recommendation mutation did not retain its result");
  return { kind: "ok" as const, id: row.id, projectVersionId: update.projectVersionId, comment: row.comment };
}

export async function deleteAdminRecommendation(
  db: D1Database,
  projectId: string,
  actorId: string,
  projectVersionId?: string,
  recommendationId?: string,
) {
  const now = new Date().toISOString();
  if (recommendationId !== undefined) {
    const results = await db.batch([
      db
        .prepare(`INSERT INTO audit_events(id,action,target_type,target_id,actor_id,detail,created_at)
        SELECT lower(hex(randomblob(16))), 'recommendation.delete', 'project', project_id, ?,
        json_object('before',json_object('projectVersionId',project_version_id,'comment',comment,'curatorId',curator_id)), ?
        FROM recommendations WHERE project_id=? AND id=?`)
        .bind(actorId, now, projectId, recommendationId),
      db.prepare(`DELETE FROM recommendations WHERE project_id=? AND id=?`).bind(projectId, recommendationId),
    ]);
    return { kind: results[1]!.meta.changes ? ("ok" as const) : ("not_found" as const) };
  }
  const condition = projectVersionId ? " AND project_version_id=?" : "";
  const values = projectVersionId ? [projectId, actorId, projectVersionId] : [projectId, actorId];
  const results = await db.batch([
    db
      .prepare(`INSERT INTO audit_events(id,action,target_type,target_id,actor_id,detail,created_at)
      SELECT lower(hex(randomblob(16))), 'recommendation.delete', 'project', project_id, ?,
      json_object('before',json_object('projectVersionId',project_version_id,'comment',comment,'curatorId',curator_id)), ?
      FROM recommendations WHERE project_id=? AND curator_id=?${condition}`)
      .bind(actorId, now, ...values),
    db.prepare(`DELETE FROM recommendations WHERE project_id=? AND curator_id=?${condition}`).bind(...values),
  ]);
  return { kind: results[1]!.meta.changes ? ("ok" as const) : ("not_found" as const) };
}
