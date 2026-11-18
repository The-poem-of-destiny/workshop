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
import { COLLECTION_LIMITS, validateCollectionMetadata } from "@workshop/domain";

const PUBLIC_PROJECT_SQL = `
  p.visibility = 'public'
  AND p.published_version_id IS NOT NULL
  AND p.deleted_at IS NULL
`;

function avatarUrl(userId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  return avatar.startsWith("https://") ? avatar : `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`;
}

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
    statements.push(db.prepare("DELETE FROM collection_projects WHERE collection_id = ?").bind(existing.id));
    for (let index = 0; index < input.projectIds.length; index++) {
      statements.push(
        db
          .prepare(`
            INSERT INTO collection_projects (collection_id, project_id, position, added_at)
            VALUES (?, ?, ?, ?)
          `)
          .bind(existing.id, input.projectIds[index]!, index, now),
      );
    }
  }
  statements.push(
    db
      .prepare(`
        INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        VALUES (?, 'collection.update', 'collection', ?, ?, ?, ?)
      `)
      .bind(
        crypto.randomUUID(),
        existing.id,
        session.userId,
        serializeAuditDetail("collection.update", { fields: fields.length > 0 ? fields : ["touch"] }),
        now,
      ),
  );
  await db.batch(statements);

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
  const project = await db
    .prepare("SELECT id, author_id FROM projects WHERE id = ? AND deleted_at IS NULL")
    .bind(projectId)
    .first<{ id: string; author_id: string }>();
  if (!project || (project.author_id !== session.userId && session.role !== "owner")) {
    return { kind: "not_found" as const };
  }

  if (collectionIds.length > 0) {
    const rows = await db
      .prepare(`
        SELECT c.id,
               (SELECT COUNT(*) FROM collection_projects cp WHERE cp.collection_id = c.id AND cp.project_id <> ?) AS other_count
        FROM collections c
        WHERE c.author_id = ? AND c.deleted_at IS NULL AND c.id IN (SELECT value FROM json_each(?))
      `)
      .bind(project.id, project.author_id, JSON.stringify(collectionIds))
      .all<{ id: string; other_count: number }>();
    if (rows.results.length !== collectionIds.length) {
      return { kind: "forbidden_collection" as const };
    }
    if (rows.results.some((row) => row.other_count + 1 > COLLECTION_LIMITS.maxProjectsPerCollection)) {
      return {
        kind: "invalid" as const,
        message: `单个合集最多包含 ${COLLECTION_LIMITS.maxProjectsPerCollection} 个项目`,
      };
    }
  }

  const currentRows = await db
    .prepare(`
      SELECT cp.collection_id
      FROM collection_projects cp
      JOIN collections c ON c.id = cp.collection_id
      WHERE cp.project_id = ? AND c.author_id = ? AND c.deleted_at IS NULL
    `)
    .bind(project.id, project.author_id)
    .all<{ collection_id: string }>();
  const currentSet = new Set(currentRows.results.map((row) => row.collection_id));
  const nextSet = new Set(collectionIds);
  const removed = [...currentSet].filter((id) => !nextSet.has(id));
  const added = collectionIds.filter((id) => !currentSet.has(id));

  if (removed.length === 0 && added.length === 0) {
    return { kind: "ok" as const, collectionIds };
  }

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const id of removed) {
    statements.push(
      db.prepare("DELETE FROM collection_projects WHERE collection_id = ? AND project_id = ?").bind(id, project.id),
      db.prepare("UPDATE collections SET updated_at = ? WHERE id = ?").bind(now, id),
      db
        .prepare(`
          INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
          VALUES (?, 'collection.update', 'collection', ?, ?, ?, ?)
        `)
        .bind(
          crypto.randomUUID(),
          id,
          session.userId,
          serializeAuditDetail("collection.update", { fields: ["projectIds"] }),
          now,
        ),
    );
  }
  for (const id of added) {
    statements.push(
      db
        .prepare(`
          INSERT INTO collection_projects (collection_id, project_id, position, added_at)
          VALUES (
            ?,
            ?,
            COALESCE((SELECT MAX(position) + 1 FROM collection_projects WHERE collection_id = ?), 0),
            ?
          )
        `)
        .bind(id, project.id, id, now),
      db.prepare("UPDATE collections SET updated_at = ? WHERE id = ?").bind(now, id),
      db
        .prepare(`
          INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
          VALUES (?, 'collection.update', 'collection', ?, ?, ?, ?)
        `)
        .bind(
          crypto.randomUUID(),
          id,
          session.userId,
          serializeAuditDetail("collection.update", { fields: ["projectIds"] }),
          now,
        ),
    );
  }
  await db.batch(statements);
  return { kind: "ok" as const, collectionIds };
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
