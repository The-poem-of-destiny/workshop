import { type AuditAction, adminAuditEventSchema, auditActionSchema, serializeAuditDetail } from "@workshop/contracts";
import { decodeCursor, encodeCursor, parseJson } from "./admin-values.js";

interface ProjectRow {
  id: string;
  author_id: string;
  author_name: string;
  title: string;
  description: string | null;
  project_type: string | null;
  extension_type: string | null;
  search_tags: string;
  visibility: "public" | "private";
  working_version_id: string | null;
  published_version_id: string | null;
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
    where.push("v.project_type = ?");
    bindings.push(filters.projectType);
  }
  if (filters.search) {
    where.push("(v.title LIKE ? OR v.description LIKE ? OR u.global_name LIKE ? OR u.username LIKE ?)");
    const pattern = `%${filters.search}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  const result = await db
    .prepare(`
    SELECT p.id, p.author_id, COALESCE(u.global_name, u.username) AS author_name,
           v.title, v.description, v.project_type, v.extension_type,
           v.tags AS search_tags, p.visibility, p.working_version_id, p.published_version_id,
           p.published_at, p.downloads_count, p.likes_count, p.subscriptions_count,
           p.row_version, p.created_at, p.updated_at, p.deleted_at
    FROM projects p JOIN users u ON u.id = p.author_id
    JOIN project_versions v ON v.id = COALESCE(p.working_version_id, p.published_version_id) AND v.project_id = p.id
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
      projectType: row.project_type,
      extensionType: row.extension_type,
      searchTags: parseJson(row.search_tags),
      visibility: row.visibility,
      author: { id: row.author_id, name: row.author_name },
      workingVersionId: row.working_version_id,
      publishedVersionId: row.published_version_id,
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
  const auditId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(`
      UPDATE users SET role = ?, updated_at = ?
      WHERE id = ? AND role = ?
        AND (role <> 'owner' OR ? = 'owner' OR (SELECT COUNT(*) FROM users WHERE role = 'owner') > 1)
    `)
      .bind(role, now, targetUserId, target.role, role),
    db
      .prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      SELECT ?, 'member.role_change', 'user', ?, ?, ?, ? WHERE changes() = 1
    `)
      .bind(
        auditId,
        targetUserId,
        actorId,
        serializeAuditDetail("member.role_change", { from: target.role, to: role }),
        now,
      ),
    db
      .prepare(`
      UPDATE sessions SET session_version = session_version + 1, revoked_at = ?
      WHERE user_id = ? AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)
    `)
      .bind(now, targetUserId, auditId),
  ]);
  if (results[0]?.meta.changes === 0) return { kind: "last_owner" as const };
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

export async function listAdminAuditEvents(
  db: D1Database,
  limit: number,
  cursor: string | undefined,
  action?: AuditAction,
) {
  const offset = decodeCursor(cursor);
  if (action !== undefined) auditActionSchema.parse(action);
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
    items: result.results.slice(0, limit).map((row) =>
      adminAuditEventSchema.parse({
        id: row.id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        actorId: row.actor_id,
        actorName: row.actor_name,
        detail: parseJson(row.detail),
        createdAt: row.created_at,
      }),
    ),
    nextCursor: result.results.length > limit ? encodeCursor(offset + limit) : null,
  };
}
