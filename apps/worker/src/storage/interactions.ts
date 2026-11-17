import type { InteractionStateItem, MeStateResponse, ProjectSummary, RatingInput } from "@workshop/contracts";
import { getPublishedProjectsByIds } from "./projects.js";

interface StateRow {
  project_id: string;
  liked: number;
  subscribed: number;
  recommendation_eligible: number;
  recommendation_version_id: string | null;
  recommendation_comment: string | null;
  rating: number | null;
  comment: string | null;
}

export async function getInteractionState(
  db: D1Database,
  userId: string,
  projectIds: string[],
): Promise<MeStateResponse> {
  if (projectIds.length === 0) return { items: [] };
  const placeholders = projectIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(`
    SELECT p.id AS project_id,
      EXISTS (SELECT 1 FROM project_likes l WHERE l.project_id = p.id AND l.user_id = ?) AS liked,
      EXISTS (SELECT 1 FROM project_subscriptions s WHERE s.project_id = p.id AND s.user_id = ? AND s.active = 1) AS subscribed,
      EXISTS (SELECT 1 FROM project_subscriptions s WHERE s.project_id = p.id AND s.user_id = ?) AS recommendation_eligible,
      rec.project_version_id AS recommendation_version_id, rec.comment AS recommendation_comment,
      (SELECT r.rating FROM project_ratings r WHERE r.project_id = p.id AND r.user_id = ?) AS rating,
      (SELECT r.comment_text FROM project_ratings r WHERE r.project_id = p.id AND r.user_id = ?) AS comment
    FROM projects p
    LEFT JOIN recommendations rec ON rec.project_version_id = p.published_version_id AND rec.curator_id = ?
    WHERE p.id IN (${placeholders})
      AND p.deleted_at IS NULL
      AND p.visibility = 'public'
      AND p.published_version_id IS NOT NULL
  `)
    .bind(userId, userId, userId, userId, userId, userId, ...projectIds)
    .all<StateRow>();
  const byId = new Map(rows.results.map((row) => [row.project_id, row]));
  const items: InteractionStateItem[] = [];
  for (const projectId of projectIds) {
    const row = byId.get(projectId);
    if (row)
      items.push({
        projectId,
        liked: Boolean(row.liked),
        subscribed: Boolean(row.subscribed),
        recommendationEligible: Boolean(row.recommendation_eligible),
        recommendation: row.recommendation_version_id
          ? { projectVersionId: row.recommendation_version_id, comment: row.recommendation_comment ?? "" }
          : null,
        rating: row.rating,
        comment: row.comment,
      });
  }
  return { items };
}

export async function listSubscribedProjects(db: D1Database, userId: string): Promise<ProjectSummary[]> {
  const rows = await db
    .prepare(`
    SELECT s.project_id FROM project_subscriptions s
    JOIN projects p ON p.id = s.project_id
    WHERE s.user_id = ? AND s.active = 1 AND p.deleted_at IS NULL
      AND p.visibility = 'public' AND p.published_version_id IS NOT NULL
    ORDER BY s.created_at DESC
  `)
    .bind(userId)
    .all<{ project_id: string }>();
  const projects = await getPublishedProjectsByIds(
    db,
    rows.results.map((row) => row.project_id),
  );
  return rows.results.flatMap((row) => {
    const project = projects.get(row.project_id);
    return project ? [project] : [];
  });
}

export async function interactionProjectExists(db: D1Database, projectId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present FROM projects
     WHERE id = ? AND deleted_at IS NULL
       AND visibility = 'public' AND published_version_id IS NOT NULL`,
    )
    .bind(projectId)
    .first<{ present: number }>();
  return Boolean(row);
}

export async function setLike(db: D1Database, userId: string, projectId: string): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO project_likes (project_id, user_id) VALUES (?, ?)")
    .bind(projectId, userId)
    .run();
}

export async function unsetLike(db: D1Database, userId: string, projectId: string): Promise<void> {
  await db.prepare("DELETE FROM project_likes WHERE project_id = ? AND user_id = ?").bind(projectId, userId).run();
}

export async function setSubscription(db: D1Database, userId: string, projectId: string): Promise<void> {
  await db
    .prepare(`INSERT INTO project_subscriptions (project_id, user_id) VALUES (?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET active = 1,
        created_at = CASE WHEN project_subscriptions.active = 0 THEN excluded.created_at ELSE project_subscriptions.created_at END`)
    .bind(projectId, userId)
    .run();
}

export async function unsetSubscription(db: D1Database, userId: string, projectId: string): Promise<void> {
  await db
    .prepare("UPDATE project_subscriptions SET active = 0 WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId)
    .run();
}

export async function setRating(db: D1Database, userId: string, projectId: string, input: RatingInput): Promise<void> {
  await db
    .prepare(`
    INSERT INTO project_ratings (project_id, user_id, rating, comment_text)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, user_id) DO UPDATE SET
      rating = excluded.rating,
      comment_text = CASE WHEN ? THEN excluded.comment_text ELSE project_ratings.comment_text END,
      updated_at = CURRENT_TIMESTAMP
  `)
    .bind(projectId, userId, input.rating, input.comment ?? null, input.comment !== undefined ? 1 : 0)
    .run();
}

export async function unsetRating(db: D1Database, userId: string, projectId: string): Promise<void> {
  await db.prepare("DELETE FROM project_ratings WHERE project_id = ? AND user_id = ?").bind(projectId, userId).run();
}
