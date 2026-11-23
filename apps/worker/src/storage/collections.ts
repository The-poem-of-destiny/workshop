import {
  type AuthorCollection,
  type AuthorProfileResponse,
  authorCollectionSchema,
  authorProfileResponseSchema,
  type CollectionSummary,
  type CreateCollection,
  collectionSummarySchema,
  type PatchCollection,
  type ProjectCollectionBadge,
  projectCollectionBadgeSchema,
  type Session,
  serializeAuditDetail,
} from "@workshop/contracts";
import { COLLECTION_LIMITS, discordAvatarUrl, validateCollectionMetadata } from "@workshop/domain";

const PUBLIC_PROJECT_SQL = `
  p.visibility = 'public'
  AND p.published_version_id IS NOT NULL
  AND p.deleted_at IS NULL
`;

const avatarUrl = discordAvatarUrl;

interface CollectionRow {
  id: string;
  author_id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
}

async function hydrateAuthorCollections(db: D1Database, rows: CollectionRow[]): Promise<AuthorCollection[]> {
  if (rows.length === 0) return [];
  const members = await db
    .prepare(`
      SELECT cp.collection_id, cp.project_id,
             CASE WHEN ${PUBLIC_PROJECT_SQL} THEN 1 ELSE 0 END AS is_public
      FROM collection_projects cp
      JOIN projects p ON p.id = cp.project_id
      WHERE cp.collection_id IN (SELECT value FROM json_each(?)) AND p.deleted_at IS NULL
      ORDER BY cp.position ASC, cp.added_at ASC, cp.project_id ASC
    `)
    .bind(JSON.stringify(rows.map((row) => row.id)))
    .all<{ collection_id: string; project_id: string; is_public: number }>();

  const byCollection = new Map<string, { projectIds: string[]; publicCount: number }>();
  for (const member of members.results) {
    const entry = byCollection.get(member.collection_id) ?? { projectIds: [], publicCount: 0 };
    entry.projectIds.push(member.project_id);
    if (member.is_public === 1) entry.publicCount += 1;
    byCollection.set(member.collection_id, entry);
  }

  return rows.map((row) => {
    const entry = byCollection.get(row.id) ?? { projectIds: [], publicCount: 0 };
    return authorCollectionSchema.parse({
      id: row.id,
      title: row.title,
      description: row.description,
      projectIds: entry.projectIds,
      publicProjectCount: entry.publicCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });
}

async function verifyOwnedProjects(db: D1Database, authorId: string, projectIds: string[]): Promise<boolean> {
  if (projectIds.length === 0) return true;
  const owned = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM projects WHERE author_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))",
    )
    .bind(authorId, JSON.stringify(projectIds))
    .first<{ count: number }>();
  return (owned?.count ?? 0) === projectIds.length;
}

export async function listAuthorCollections(db: D1Database, userId: string): Promise<AuthorCollection[]> {
  const rows = await db
    .prepare(`
      SELECT id, author_id, title, description, created_at, updated_at
      FROM collections
      WHERE author_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC, id DESC
    `)
    .bind(userId)
    .all<CollectionRow>();
  return hydrateAuthorCollections(db, rows.results);
}

export async function createAuthorCollection(db: D1Database, session: Session, input: CreateCollection) {
  const validation = validateCollectionMetadata({ title: input.title, description: input.description });
  if (!validation.ok) return { kind: "invalid" as const, message: validation.message };

  const countRow = await db
    .prepare("SELECT COUNT(*) AS count FROM collections WHERE author_id = ? AND deleted_at IS NULL")
    .bind(session.userId)
    .first<{ count: number }>();
  if ((countRow?.count ?? 0) >= COLLECTION_LIMITS.maxCollectionsPerAuthor) {
    return {
      kind: "invalid" as const,
      message: `每位作者最多创建 ${COLLECTION_LIMITS.maxCollectionsPerAuthor} 个合集`,
    };
  }

  if (!(await verifyOwnedProjects(db, session.userId, input.projectIds))) {
    return { kind: "forbidden_project" as const };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = input.title.trim();
  const description = input.description.trim();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(`
        INSERT INTO collections (id, author_id, title, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(id, session.userId, title, description, now, now),
  ];
  for (let index = 0; index < input.projectIds.length; index++) {
    statements.push(
      db
        .prepare(`
          INSERT INTO collection_projects (collection_id, project_id, position, added_at)
          VALUES (?, ?, ?, ?)
        `)
        .bind(id, input.projectIds[index]!, index, now),
    );
  }
  statements.push(
    db
      .prepare(`
        INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        VALUES (?, 'collection.create', 'collection', ?, ?, ?, ?)
      `)
      .bind(crypto.randomUUID(), id, session.userId, serializeAuditDetail("collection.create", { title }), now),
  );
  await db.batch(statements);

  const [created] = await hydrateAuthorCollections(db, [
    { id, author_id: session.userId, title, description, created_at: now, updated_at: now },
  ]);
  return { kind: "ok" as const, data: created! };
}

export async function patchAuthorCollection(
  db: D1Database,
  session: Session,
  collectionId: string,
  input: PatchCollection,
) {
  const existing = await db
    .prepare(`
      SELECT id, author_id, title, description, created_at, updated_at
      FROM collections
      WHERE id = ? AND deleted_at IS NULL
    `)
    .bind(collectionId)
    .first<CollectionRow>();
  if (!existing || (existing.author_id !== session.userId && session.role !== "owner")) {
    return { kind: "not_found" as const };
  }

  const title = input.title !== undefined ? input.title.trim() : existing.title;
  const description = input.description !== undefined ? input.description.trim() : existing.description;
  const validation = validateCollectionMetadata({ title, description });
  if (!validation.ok) return { kind: "invalid" as const, message: validation.message };

  if (input.projectIds !== undefined && !(await verifyOwnedProjects(db, existing.author_id, input.projectIds))) {
    return { kind: "forbidden_project" as const };
  }

  const now = new Date().toISOString();
  const fields: string[] = [];
  if (input.title !== undefined && title !== existing.title) fields.push("title");
  if (input.description !== undefined && description !== existing.description) fields.push("description");
  if (input.projectIds !== undefined) fields.push("projectIds");

  const statements: D1PreparedStatement[] = [
    db
      .prepare("UPDATE collections SET title = ?, description = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(title, description, now, existing.id),
  ];
  if (input.projectIds !== undefined) {
    statements.push(
      db
        .prepare(
          "DELETE FROM collection_projects WHERE collection_id = ? AND EXISTS (SELECT 1 FROM collections WHERE id = ? AND deleted_at IS NULL)",
        )
        .bind(existing.id, existing.id),
    );
    for (let index = 0; index < input.projectIds.length; index++) {
      statements.push(
        db
          .prepare(`
            INSERT INTO collection_projects (collection_id, project_id, position, added_at)
            SELECT ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM collections WHERE id = ? AND deleted_at IS NULL)
              AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND author_id = ? AND deleted_at IS NULL)
          `)
          .bind(
            existing.id,
            input.projectIds[index]!,
            index,
            now,
            existing.id,
            input.projectIds[index]!,
            existing.author_id,
          ),
      );
    }
  }
  statements.push(
    db
      .prepare(`
        INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        SELECT ?, 'collection.update', 'collection', ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM collections WHERE id = ? AND deleted_at IS NULL)
      `)
      .bind(
        crypto.randomUUID(),
        existing.id,
        session.userId,
        serializeAuditDetail("collection.update", { fields: fields.length > 0 ? fields : ["touch"] }),
        now,
        existing.id,
      ),
  );
  const results = await db.batch(statements);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    return { kind: "not_found" as const };
  }

  const [updated] = await hydrateAuthorCollections(db, [{ ...existing, title, description, updated_at: now }]);
  return { kind: "ok" as const, data: updated! };
}

export async function softDeleteAuthorCollection(db: D1Database, session: Session, collectionId: string) {
  const existing = await db
    .prepare("SELECT id, author_id FROM collections WHERE id = ? AND deleted_at IS NULL")
    .bind(collectionId)
    .first<{ id: string; author_id: string }>();
  if (!existing || (existing.author_id !== session.userId && session.role !== "owner")) {
    return { kind: "not_found" as const };
  }
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("UPDATE collections SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(now, now, existing.id),
    db.prepare("DELETE FROM collection_projects WHERE collection_id = ?").bind(existing.id),
    db
      .prepare(`
        INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        VALUES (?, 'collection.delete', 'collection', ?, ?, ?, ?)
      `)
      .bind(
        crypto.randomUUID(),
        existing.id,
        session.userId,
        serializeAuditDetail("collection.delete", { soft: true }),
        now,
      ),
  ]);
  return { kind: "ok" as const };
}

export async function setProjectCollections(
  db: D1Database,
  session: Session,
  projectId: string,
  collectionIds: string[],
) {
  type Eligibility = "ok" | "not_found" | "forbidden_collection" | "invalid";

  const eligibility = `
    WITH project AS (
      SELECT author_id FROM projects
      WHERE id = ?1 AND deleted_at IS NULL AND (author_id = ?2 OR ?3)
    ), requested AS (
      SELECT value AS id FROM json_each(?4)
    ), targets AS (
      SELECT c.id FROM collections c JOIN project p ON p.author_id = c.author_id
      WHERE c.deleted_at IS NULL AND c.id IN (SELECT id FROM requested)
    ), eligibility AS (
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM project) THEN 'not_found'
        WHEN (SELECT COUNT(*) FROM targets) <> (SELECT COUNT(*) FROM requested) THEN 'forbidden_collection'
        WHEN EXISTS (
          SELECT 1 FROM targets t WHERE (
            SELECT COUNT(*) FROM collection_projects cp
            JOIN projects p2 ON p2.id = cp.project_id
            WHERE cp.collection_id = t.id AND cp.project_id <> ?1 AND p2.deleted_at IS NULL
          ) >= ?5
        ) THEN 'invalid'
        ELSE 'ok'
      END AS kind
    )
  `;
  const delta = `
    ${eligibility}, current_memberships AS (
      SELECT cp.collection_id AS id FROM collection_projects cp
      JOIN collections c ON c.id = cp.collection_id
      JOIN project p ON p.author_id = c.author_id
      WHERE cp.project_id = ?1 AND c.deleted_at IS NULL
    ), removed AS (
      SELECT id FROM current_memberships EXCEPT SELECT id FROM targets
    ), added AS (
      SELECT id FROM targets EXCEPT SELECT id FROM current_memberships
    )
  `;
  const allowed = "(SELECT kind FROM eligibility) = 'ok'";
  const changed = "SELECT id FROM removed UNION ALL SELECT id FROM added";
  const args = [
    projectId,
    session.userId,
    session.role === "owner" ? 1 : 0,
    JSON.stringify(collectionIds),
    COLLECTION_LIMITS.maxProjectsPerCollection,
  ];
  const now = new Date().toISOString();

  // Every mutation uses the same whole-request guard. Membership writes cannot
  // change it: the capacity query deliberately excludes this project's rows.
  // Record the delta before changing membership, in this same transaction.
  const [result] = await db.batch<{ kind: Eligibility }>([
    db.prepare(`${eligibility} SELECT kind FROM eligibility`).bind(...args),
    db
      .prepare(`
        ${delta}
        INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        SELECT lower(hex(randomblob(16))), 'collection.update', 'collection', id, ?2, ?7, ?6
        FROM (${changed}) WHERE ${allowed}
      `)
      .bind(...args, now, serializeAuditDetail("collection.update", { fields: ["projectIds"] })),
    db
      .prepare(`
        ${delta}
        UPDATE collections SET updated_at = ?6 WHERE ${allowed} AND id IN (${changed})
      `)
      .bind(...args, now),
    db
      .prepare(`
        ${delta}
        DELETE FROM collection_projects WHERE project_id = ?1 AND ${allowed} AND collection_id IN (SELECT id FROM removed)
      `)
      .bind(...args),
    db
      .prepare(`
        ${delta}
        INSERT INTO collection_projects (collection_id, project_id, position, added_at)
        SELECT a.id, ?1, COALESCE((SELECT MAX(position) + 1 FROM collection_projects WHERE collection_id = a.id), 0), ?6
        FROM added a WHERE ${allowed}
      `)
      .bind(...args, now),
  ]);

  const { kind } = result!.results[0]!;
  if (kind === "invalid") {
    return { kind, message: `单个合集最多包含 ${COLLECTION_LIMITS.maxProjectsPerCollection} 个项目` };
  }
  if (kind === "not_found") return { kind };
  if (kind === "forbidden_collection") return { kind };
  return { kind, collectionIds };
}

export async function listAuthorCollectionIdsByProjects(
  db: D1Database,
  projectIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (projectIds.length === 0) return map;
  const rows = await db
    .prepare(`
      SELECT cp.project_id, cp.collection_id
      FROM collection_projects cp
      JOIN collections c ON c.id = cp.collection_id
      WHERE cp.project_id IN (SELECT value FROM json_each(?)) AND c.deleted_at IS NULL
      ORDER BY c.updated_at DESC, c.id DESC
    `)
    .bind(JSON.stringify(projectIds))
    .all<{ project_id: string; collection_id: string }>();
  for (const row of rows.results) {
    const list = map.get(row.project_id) ?? [];
    list.push(row.collection_id);
    map.set(row.project_id, list);
  }
  return map;
}

export async function listPublicCollectionsForProject(
  db: D1Database,
  projectId: string,
): Promise<ProjectCollectionBadge[]> {
  const rows = await db
    .prepare(`
      SELECT c.id, c.title, c.description,
             (
               SELECT COUNT(*)
               FROM collection_projects cp2
               JOIN projects p ON p.id = cp2.project_id
               WHERE cp2.collection_id = c.id AND ${PUBLIC_PROJECT_SQL}
             ) AS project_count
      FROM collection_projects cp
      JOIN collections c ON c.id = cp.collection_id
      WHERE cp.project_id = ? AND c.deleted_at IS NULL
      ORDER BY c.updated_at DESC, c.id DESC
    `)
    .bind(projectId)
    .all<{ id: string; title: string; description: string; project_count: number }>();

  return rows.results
    .filter((row) => row.project_count > 0)
    .map((row) =>
      projectCollectionBadgeSchema.parse({
        id: row.id,
        title: row.title,
        description: row.description,
        projectCount: row.project_count,
      }),
    );
}

export async function getPublicCollection(db: D1Database, collectionId: string): Promise<CollectionSummary | null> {
  const row = await db
    .prepare(`
      SELECT c.id, c.title, c.description, c.updated_at,
             u.id AS author_id, COALESCE(u.global_name, u.username) AS author_name, u.avatar AS author_avatar,
             (
               SELECT COUNT(*)
               FROM collection_projects cp
               JOIN projects p ON p.id = cp.project_id
               WHERE cp.collection_id = c.id AND ${PUBLIC_PROJECT_SQL}
             ) AS project_count
      FROM collections c
      JOIN users u ON u.id = c.author_id
      WHERE c.id = ? AND c.deleted_at IS NULL
    `)
    .bind(collectionId)
    .first<{
      id: string;
      title: string;
      description: string;
      updated_at: string;
      author_id: string;
      author_name: string;
      author_avatar: string | null;
      project_count: number;
    }>();
  if (!row || row.project_count <= 0) return null;
  return collectionSummarySchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    author: {
      id: row.author_id,
      name: row.author_name,
      avatarUrl: avatarUrl(row.author_id, row.author_avatar),
    },
    projectCount: row.project_count,
    updatedAt: row.updated_at,
  });
}

export async function getPublicAuthorProfile(db: D1Database, authorId: string): Promise<AuthorProfileResponse | null> {
  const authorRow = await db
    .prepare(`
      SELECT u.id, COALESCE(u.global_name, u.username) AS name, u.avatar,
             (SELECT COUNT(*) FROM projects p WHERE p.author_id = u.id AND ${PUBLIC_PROJECT_SQL}) AS project_count
      FROM users u
      WHERE u.id = ?
    `)
    .bind(authorId)
    .first<{ id: string; name: string; avatar: string | null; project_count: number }>();
  if (!authorRow || authorRow.project_count <= 0) return null;

  const collectionRows = await db
    .prepare(`
      SELECT c.id, c.title, c.description, c.updated_at,
             (
               SELECT COUNT(*)
               FROM collection_projects cp
               JOIN projects p ON p.id = cp.project_id
               WHERE cp.collection_id = c.id AND ${PUBLIC_PROJECT_SQL}
             ) AS project_count
      FROM collections c
      WHERE c.author_id = ? AND c.deleted_at IS NULL
      ORDER BY c.updated_at DESC, c.id DESC
    `)
    .bind(authorId)
    .all<{ id: string; title: string; description: string; updated_at: string; project_count: number }>();

  const author = {
    id: authorRow.id,
    name: authorRow.name,
    avatarUrl: avatarUrl(authorRow.id, authorRow.avatar),
  };

  return authorProfileResponseSchema.parse({
    author,
    projectCount: authorRow.project_count,
    collections: collectionRows.results
      .filter((row) => row.project_count > 0)
      .map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        author,
        projectCount: row.project_count,
        updatedAt: row.updated_at,
      })),
  });
}
