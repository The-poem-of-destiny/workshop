import type { InteractionStateItem, MeStateResponse, RatingInput } from "@workshop/contracts";

interface StateRow {
  project_id: string;
  liked: number;
  subscribed: number;
  rating: number | null;
}

export async function getInteractionState(
  db: D1Database,
  userId: string,
  projectIds: string[],
): Promise<MeStateResponse> {
  if (projectIds.length === 0) return { items: [] };
  const placeholders = projectIds.map(() => "?").join(", ");
  const rows = await db.prepare(`
    SELECT p.id AS project_id,
      EXISTS (SELECT 1 FROM project_likes l WHERE l.project_id = p.id AND l.user_id = ?) AS liked,
      EXISTS (SELECT 1 FROM project_subscriptions s WHERE s.project_id = p.id AND s.user_id = ?) AS subscribed,
      (SELECT r.rating FROM project_ratings r WHERE r.project_id = p.id AND r.user_id = ?) AS rating
    FROM projects p
    WHERE p.id IN (${placeholders}) AND p.deleted_at IS NULL
  `).bind(userId, userId, userId, ...projectIds).all<StateRow>();
  const byId = new Map(rows.results.map(row => [row.project_id, row]));
  const items: InteractionStateItem[] = [];
  for (const projectId of projectIds) {
    const row = byId.get(projectId);
    if (row) items.push({ projectId, liked: Boolean(row.liked), subscribed: Boolean(row.subscribed), rating: row.rating });
  }
  return { items };
}

export async function interactionProjectExists(db: D1Database, projectId: string): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 AS present FROM projects WHERE id = ? AND deleted_at IS NULL",
  ).bind(projectId).first<{ present: number }>();
  return Boolean(row);
}

export async function setLike(db: D1Database, userId: string, projectId: string): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO project_likes (project_id, user_id) VALUES (?, ?)")
    .bind(projectId, userId).run();
}

export async function unsetLike(db: D1Database, userId: string, projectId: string): Promise<void> {
  await db.prepare("DELETE FROM project_likes WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId).run();
}

export async function setSubscription(db: D1Database, userId: string, projectId: string): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO project_subscriptions (project_id, user_id) VALUES (?, ?)")
    .bind(projectId, userId).run();
}

export async function unsetSubscription(db: D1Database, userId: string, projectId: string): Promise<void> {
  await db.prepare("DELETE FROM project_subscriptions WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId).run();
}

export async function setRating(db: D1Database, userId: string, projectId: string, input: RatingInput): Promise<void> {
  await db.prepare(`
    INSERT INTO project_ratings (project_id, user_id, rating, comment_text)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, user_id) DO UPDATE SET
      rating = excluded.rating,
      comment_text = excluded.comment_text,
      updated_at = CURRENT_TIMESTAMP
  `).bind(projectId, userId, input.rating, input.comment ?? null).run();
}

export async function unsetRating(db: D1Database, userId: string, projectId: string): Promise<void> {
  await db.prepare("DELETE FROM project_ratings WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId).run();
}
