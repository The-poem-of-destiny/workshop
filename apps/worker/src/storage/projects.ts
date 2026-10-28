import {
  type ProjectDetail,
  type ProjectListQuery,
  type ProjectSummary,
  projectDetailSchema,
  projectListResponseSchema,
} from "@workshop/contracts";

interface ProjectRow {
  id: string;
  title: string;
  description: string | null;
  author_note: string | null;
  project_type: string | null;
  extension_type: string | null;
  visibility: "public" | "private";
  published_at: string | null;
  updated_at: string;
  downloads_count: number;
  likes_count: number;
  subscriptions_count: number;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  tags: string;
  worldbook_count: number;
  regex_count: number;
  schema_version: string | null;
  version_label: string | null;
  precautions: string | null;
  cover_position_x: number;
  cover_position_y: number;
  cover_zoom: number;
  discord_thread_url: string | null;
  cover_key: string | null;
  published_revision_id: string | null;
  gallery: string;
  catalog_score?: number;
}

const PUBLIC_UPDATED_AT = `COALESCE((SELECT MAX(s.resolved_at) FROM submissions s
  WHERE s.revision_id = p.published_revision_id AND s.status = 'approved'), p.published_at, r.created_at)`;

const SELECT_PROJECT = `
  SELECT
    p.id, p.title, p.description, p.author_note, p.project_type, p.extension_type,
    p.visibility, p.published_at, ${PUBLIC_UPDATED_AT} AS updated_at, p.published_revision_id,
    p.downloads_count, p.likes_count, p.subscriptions_count,
    u.id AS author_id,
    COALESCE(u.global_name, u.username) AS author_name,
    u.avatar AS author_avatar,
    p.search_tags AS tags, r.worldbook_count, r.regex_count,
    p.published_schema_version AS schema_version,
    p.version_label, p.precautions,
    p.cover_position_x, p.cover_position_y, p.cover_zoom,
    p.published_discord_thread_url AS discord_thread_url,
    COALESCE(
      (
        SELECT a.r2_key
        FROM assets a
        WHERE a.id = p.published_cover_asset_id
          AND a.project_id = p.id
          AND a.revision_id IS NULL
          AND a.kind = 'cover'
      ),
      (
        SELECT a.r2_key
        FROM assets a
        WHERE a.revision_id = p.published_revision_id AND a.kind = 'cover'
        LIMIT 1
      )
    ) AS cover_key,
    COALESCE(
      (
        SELECT json_group_array(json_object('slot', g.slot, 'url', '/api/v1/public-assets/' || g.r2_key))
        FROM project_gallery g WHERE g.project_id = p.id
      ),
      '[]'
    ) AS gallery
  FROM projects p
  JOIN users u ON u.id = p.author_id
  JOIN project_revisions r ON r.id = p.published_revision_id
`;

const SELECT_PERIOD_PROJECT = SELECT_PROJECT.replace("p.id,", "COALESCE(metric.score, 0) AS catalog_score, p.id,");

const PUBLIC_PROJECT = `
  p.visibility = 'public'
  AND p.published_revision_id IS NOT NULL
  AND p.deleted_at IS NULL
`;

function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}
function parseGallery(value: string): Array<{ slot: number; url: string }> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is { slot: number; url: string } =>
        typeof item === "object" &&
        item !== null &&
        "slot" in item &&
        typeof item.slot === "number" &&
        "url" in item &&
        typeof item.url === "string",
    );
  } catch {
    return [];
  }
}
function avatarUrl(userId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  if (avatar.startsWith("https://")) return avatar;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`;
}

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    author: {
      id: row.author_id,
      name: row.author_name,
      avatarUrl: avatarUrl(row.author_id, row.author_avatar),
    },
    projectType: row.project_type as ProjectSummary["projectType"],
    extensionType: row.extension_type as ProjectSummary["extensionType"],
    tags: parseTags(row.tags),
    entries: {
      worldbook: row.worldbook_count,
      regex: row.regex_count,
    },
    schemaVersion: row.schema_version,
    authorNote: row.author_note,
    discordThreadUrl: row.discord_thread_url,
    versionLabel: row.version_label,
    coverPositionX: row.cover_position_x,
    coverPositionY: row.cover_position_y,
    coverZoom: row.cover_zoom,
    counts: {
      downloads: row.downloads_count,
      likes: row.likes_count,
      subscriptions: row.subscriptions_count,
    },
    coverUrl: row.cover_key ? `/api/v1/public-assets/${row.cover_key}` : null,
    gallery: parseGallery(row.gallery),
    visibility: row.visibility,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    publishedRevisionId: row.published_revision_id,
  };
}

function toDetail(row: ProjectRow): ProjectDetail {
  return {
    ...toSummary(row),
    authorNote: row.author_note,
    precautions: row.precautions,
    discordThreadUrl: row.discord_thread_url,
  };
}

interface CatalogCursor {
  scope: string;
  asOf: string;
  value: string | number;
  id: string;
}

function cursorScope(query: ProjectListQuery): string {
  return JSON.stringify([
    query.sort,
    query.period ?? "all",
    query.projectType ?? null,
    query.authorId ?? null,
    query.tag ?? null,
    query.search ?? null,
  ]);
}

function encodeCursor(cursor: CatalogCursor): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor))));
}

function decodeCursor(cursor: string | undefined, query: ProjectListQuery): CatalogCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0))),
    ) as Partial<CatalogCursor>;
    const numeric = query.sort === "likes" || query.sort === "downloads";
    if (
      parsed.scope === cursorScope(query) &&
      typeof parsed.id === "string" &&
      typeof parsed.asOf === "string" &&
      Number.isFinite(Date.parse(parsed.asOf)) &&
      new Date(parsed.asOf).toISOString() === parsed.asOf &&
      (numeric ? typeof parsed.value === "number" && Number.isFinite(parsed.value) : typeof parsed.value === "string")
    ) {
      return parsed as CatalogCursor;
    }
  } catch {
    return null;
  }
  return null;
}

export function isValidProjectListCursor(query: ProjectListQuery): boolean {
  return !query.cursor || decodeCursor(query.cursor, query) !== null;
}

const SORT_COLUMN: Record<ProjectListQuery["sort"], string> = {
  updated: PUBLIC_UPDATED_AT,
  published: "COALESCE(p.published_at, '')",
  downloads: "p.downloads_count",
  likes: "p.likes_count",
};

function sortValue(row: ProjectRow, sort: ProjectListQuery["sort"], periodic: boolean): string | number {
  if (sort === "published") return row.published_at ?? "";
  if (periodic) return row.catalog_score ?? 0;
  if (sort === "downloads") return row.downloads_count;
  if (sort === "likes") return row.likes_count;
  return row.updated_at;
}

function searchPredicate(search: string): { sql: string; values: unknown[] } {
  const trimmed = search.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= 2) {
    // The short index stores one token per character, separated by spaces.
    // A quoted phrase keeps character order and makes FTS operators inert.
    const phrase = chars.map((char) => `"${char.replaceAll('"', '""')}"`).join(" ");
    return {
      sql: "p.rowid IN (SELECT rowid FROM project_search_short WHERE project_search_short MATCH ?)",
      values: [phrase],
    };
  }
  return {
    sql: "p.rowid IN (SELECT rowid FROM project_search WHERE project_search MATCH ?)",
    values: [`"${trimmed.replaceAll('"', '""')}"`],
  };
}

// Each page is a bounded keyset query plus an exact count of the same filters.

export async function listPublishedProjects(
  db: D1Database,
  query: ProjectListQuery,
  onMeta?: (meta: { rows_read: number; rows_written: number }) => void,
) {
  const cursor = decodeCursor(query.cursor, query);
  if (query.cursor && !cursor) throw new Error("Invalid catalog cursor");
  const asOf = cursor?.asOf ?? new Date().toISOString();
  const period = query.period ?? "all";
  const periodic = period !== "all" && (query.sort === "likes" || query.sort === "downloads");
  const where = [PUBLIC_PROJECT];
  const bindings: unknown[] = [];

  if (query.projectType) {
    where.push("p.project_type = ?");
    bindings.push(query.projectType);
  }
  if (query.authorId) {
    where.push("p.author_id = ?");
    bindings.push(query.authorId);
  }
  if (query.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(p.search_tags) WHERE json_each.value = ?)");
    bindings.push(query.tag);
  }
  if (query.search) {
    const predicate = searchPredicate(query.search);
    where.push(predicate.sql);
    bindings.push(...predicate.values);
  }

  const filterSql = where.join(" AND ");
  const filterBindings = [...bindings];
  let prefix = "";
  let metricJoin = "";
  const metricBindings: unknown[] = [];
  if (periodic) {
    const days = Number.parseInt(period, 10);
    const start = new Date(Date.parse(asOf) - days * 86_400_000).toISOString();
    const table = query.sort === "likes" ? "project_like_events" : "download_events";
    const time = query.sort === "likes" ? "occurred_at" : "created_at";
    const aggregate = query.sort === "likes" ? "SUM(delta)" : "COUNT(*)";
    prefix = `WITH metric AS (SELECT project_id, ${aggregate} AS score FROM ${table}
      WHERE ${time} >= ? AND ${time} <= ? GROUP BY project_id) `;
    metricBindings.push(start, asOf);
    metricJoin = " LEFT JOIN metric ON metric.project_id = p.id ";
  }
  const column = periodic ? "COALESCE(metric.score, 0)" : SORT_COLUMN[query.sort];
  if (cursor) {
    where.push(`(${column} < ? OR (${column} = ? AND p.id < ?))`);
    bindings.push(cursor.value, cursor.value, cursor.id);
  }
  const select = periodic ? SELECT_PERIOD_PROJECT : SELECT_PROJECT;
  const results = await db.batch([
    db
      .prepare(`SELECT COUNT(*) AS total FROM projects p
      JOIN users u ON u.id = p.author_id
      JOIN project_revisions r ON r.id = p.published_revision_id WHERE ${filterSql}`)
      .bind(...filterBindings),
    db
      .prepare(`${prefix}${select}${metricJoin} WHERE ${where.join(" AND ")}
      ORDER BY ${column} DESC, p.id DESC LIMIT ?`)
      .bind(...metricBindings, ...bindings, query.limit + 1),
  ]);
  const count = results[0]!;
  const result = results[1]!;
  onMeta?.({
    rows_read: count.meta.rows_read + result.meta.rows_read,
    rows_written: count.meta.rows_written + result.meta.rows_written,
  });
  const rows = (result.results as unknown as ProjectRow[]).slice(0, query.limit);
  const hasMore = result.results.length > query.limit;
  const last = rows.at(-1);
  const totalRow = count.results[0] as { total?: unknown } | undefined;
  if (!totalRow || typeof totalRow.total !== "number") throw new Error("Invalid catalog count");
  return projectListResponseSchema.parse({
    items: rows.map(toSummary),
    total: totalRow.total,
    nextCursor:
      hasMore && last
        ? encodeCursor({ scope: cursorScope(query), asOf, value: sortValue(last, query.sort, periodic), id: last.id })
        : null,
  });
}

export async function getPublishedProject(db: D1Database, id: string) {
  const row = await db.prepare(`${SELECT_PROJECT} WHERE p.id = ? AND ${PUBLIC_PROJECT}`).bind(id).first<ProjectRow>();
  return row ? projectDetailSchema.parse(toDetail(row)) : null;
}

export async function getPublishedProjectsByIds(db: D1Database, ids: string[]) {
  if (ids.length === 0) return new Map<string, ProjectSummary>();
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db
    .prepare(`${SELECT_PROJECT} WHERE p.id IN (${placeholders}) AND ${PUBLIC_PROJECT}`)
    .bind(...ids)
    .all<ProjectRow>();
  return new Map(result.results.map((row) => [row.id, toSummary(row)]));
}
