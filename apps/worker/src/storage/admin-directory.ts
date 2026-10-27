import { decodeCursor, encodeCursor, parseJson } from "./admin-values.js";

interface ProjectRow {
  id: string;
  author_id: string;
  author_name: string;
  title: string;
  description: string | null;
  author_note: string | null;
  project_type: string | null;
  extension_type: string | null;
  search_tags: string;
  visibility: "public" | "private";
  working_revision_id: string | null;
  published_revision_id: string | null;
  published_at: string | null;
  downloads_count: number;
  likes_count: number;
  subscriptions_count: number;
  row_version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MemberRow {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  role: "member" | "reviewer" | "owner";
  created_at: string;
  updated_at: string;
}

export async function listAdminProjects(
  db: D1Database,
  limit: number,
  cursor?: string,
  filters: { search?: string; projectType?: string; includeDeleted?: boolean } = {},
) {
  const offset = decodeCursor(cursor);
  const where: string[] = [];
  const bindings: unknown[] = [];
  if (!filters.includeDeleted) where.push("p.deleted_at IS NULL");
  if (filters.projectType) {
    where.push("p.project_type = ?");
    bindings.push(filters.projectType);
  }
  if (filters.search) {
    where.push("(p.title LIKE ? OR p.description LIKE ? OR u.global_name LIKE ? OR u.username LIKE ?)");
    const pattern = `%${filters.search}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  const result = await db
    .prepare(`
    SELECT p.id, p.author_id, COALESCE(u.global_name, u.username) AS author_name,
           p.title, p.description, p.author_note, p.project_type, p.extension_type,
           p.search_tags, p.visibility, p.working_revision_id, p.published_revision_id,
           p.published_at, p.downloads_count, p.likes_count, p.subscriptions_count,
           p.row_version, p.created_at, p.updated_at, p.deleted_at
    FROM projects p JOIN users u ON u.id = p.author_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY p.updated_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `)
    .bind(...bindings, limit + 1, offset)
    .all<ProjectRow>();
  return {
    items: result.results.slice(0, limit).map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      authorNote: row.author_note,
      projectType: row.project_type,
      extensionType: row.extension_type,
      searchTags: parseJson(row.search_tags),
      visibility: row.visibility,
      author: { id: row.author_id, name: row.author_name },
      workingRevisionId: row.working_revision_id,
      publishedRevisionId: row.published_revision_id,
      publishedAt: row.published_at,
      counts: { downloads: row.downloads_count, likes: row.likes_count, subscriptions: row.subscriptions_count },
      rowVersion: row.row_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    })),
    nextCursor: result.results.length > limit ? encodeCursor(offset + limit) : null,
  };
}

export async function listAdminMembers(db: D1Database, limit: number, cursor?: string) {
  const offset = decodeCursor(cursor);
  const result = await db
    .prepare(`
    SELECT id, username, global_name, avatar, role, created_at, updated_at
    FROM users ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?
  `)
    .bind(limit + 1, offset)
    .all<MemberRow>();
  return {
    items: result.results.slice(0, limit).map((row) => ({
      id: row.id,
      username: row.username,
      globalName: row.global_name,
      avatar: row.avatar,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    nextCursor: result.results.length > limit ? encodeCursor(offset + limit) : null,
  };
}

export async function changeAdminMemberRole(
  db: D1Database,
  targetUserId: string,
  role: "member" | "reviewer" | "owner",
  actorId: string,
) {
  const target = await db
    .prepare("SELECT id, role FROM users WHERE id = ?")
    .bind(targetUserId)
    .first<{ id: string; role: "member" | "reviewer" | "owner" }>();
  if (!target) return { kind: "not_found" as const };

  const now = new Date().toISOString();
  const updated = await db
    .prepare(`
    UPDATE users SET role = ?, updated_at = ?
    WHERE id = ?
      AND (role <> 'owner' OR ? = 'owner' OR (SELECT COUNT(*) FROM users WHERE role = 'owner') > 1)
  `)
    .bind(role, now, targetUserId, role)
    .run();
  if (updated.meta.changes === 0) return { kind: "last_owner" as const };

  await db.batch([
    db
      .prepare("UPDATE sessions SET session_version = session_version + 1, revoked_at = ? WHERE user_id = ?")
      .bind(now, targetUserId),
    db
      .prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      VALUES (?, 'member.role_change', 'user', ?, ?, ?, ?)
    `)
      .bind(crypto.randomUUID(), targetUserId, actorId, JSON.stringify({ from: target.role, to: role }), now),
  ]);
  return { kind: "ok" as const };
}
interface AuditEventRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  detail: string | null;
  created_at: string;
}

export async function listAdminAuditEvents(db: D1Database, limit: number, cursor: string | undefined, action?: string) {
  const offset = decodeCursor(cursor);
  const where = action ? "WHERE e.action = ?" : "";
  const result = await db
    .prepare(`
    SELECT e.id, e.action, e.target_type, e.target_id, e.actor_id, e.detail, e.created_at,
           CASE WHEN u.id IS NULL THEN NULL ELSE COALESCE(u.global_name, u.username) END AS actor_name
    FROM audit_events e
    LEFT JOIN users u ON u.id = e.actor_id
    ${where}
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ? OFFSET ?
  `)
    .bind(...(action ? [action] : []), limit + 1, offset)
    .all<AuditEventRow>();
  return {
    items: result.results.slice(0, limit).map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      detail: parseJson(row.detail),
      createdAt: row.created_at,
    })),
    nextCursor: result.results.length > limit ? encodeCursor(offset + limit) : null,
  };
}
