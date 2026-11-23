import {
  type ProjectDetail,
  type ProjectListQuery,
  type ProjectSummary,
  projectDetailSchema,
  projectListResponseSchema,
} from "@workshop/contracts";
import { discordAvatarUrl, presetTagGroup } from "@workshop/domain";
import { parseIncludedTypes, parseRequirements, parseTags } from "./authoring-model.js";
import { listPublicCollectionsForProject } from "./collections.js";
import { sha256Hex } from "./identity.js";

interface ProjectRow {
  id: string;
  title: string;
  description: string | null;
  project_type: ProjectSummary["projectType"];
  included_types: string;
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
  requirements: string | null;
  cover_position_x: number;
  cover_position_y: number;
  cover_zoom: number;
  discord_thread_url: string | null;
  cover_key: string | null;
  public_cover_key: string | null;
  published_version_id: string | null;
  gallery: string;
  catalog_score?: number;
}

const PUBLIC_UPDATED_AT = "COALESCE(p.published_updated_at, p.published_at, r.created_at)";

const SELECT_PROJECT = `
  SELECT
    p.id, r.title, r.description, r.project_type, r.included_types,
    p.visibility, p.published_at, ${PUBLIC_UPDATED_AT} AS updated_at, p.published_version_id,
    p.downloads_count, p.likes_count, p.subscriptions_count,
    u.id AS author_id,
    COALESCE(u.global_name, u.username) AS author_name,
    u.avatar AS author_avatar,
    r.tags, r.worldbook_count, r.regex_count,
    r.schema_version,
    r.version_label, r.requirements,
    r.cover_position_x, r.cover_position_y, r.cover_zoom,
    r.discord_thread_url,
    COALESCE(
      (
        SELECT a.r2_key
        FROM assets a
        WHERE a.id = p.published_cover_asset_id
          AND a.project_id = p.id
          AND a.version_id IS NULL
          AND a.kind = 'cover'
      ),
      (
        SELECT a.r2_key
        FROM assets a
        WHERE a.version_id = p.published_version_id AND a.kind = 'cover'
        LIMIT 1
      )
    ) AS cover_key,
    (SELECT c.object_key FROM public_cover_replicas c WHERE c.project_id = p.id AND c.phase = 'ready') AS public_cover_key,
    COALESCE(
      (
        SELECT json_group_array(json_object(
          'slot', CASE g.kind WHEN 'gallery_1' THEN 0 ELSE 1 END,
          'key', g.r2_key,
          'publicKey', replica.object_key
        ) ORDER BY g.kind)
        FROM assets g
        LEFT JOIN public_gallery_replicas replica ON replica.project_id = g.project_id
          AND replica.kind = g.kind AND replica.asset_id = g.id AND replica.phase = 'ready'
        WHERE g.project_id = p.id AND g.version_id IS NULL AND g.kind IN ('gallery_1','gallery_2')
      ),
      '[]'
    ) AS gallery`;

const PROJECT_SOURCE = "projects p";
const PROJECT_JOINS = `
  JOIN users u ON u.id = p.author_id
  JOIN project_versions r ON r.id = p.published_version_id
`;

const PUBLIC_PROJECT = `
  p.visibility = 'public'
  AND p.published_version_id IS NOT NULL
  AND p.deleted_at IS NULL
`;

function publicImageUrl(key: string, publicKey: string | null, baseUrl?: string): string {
  return baseUrl && publicKey ? `${baseUrl.replace(/\/$/, "")}/${publicKey}` : `/api/v1/public-assets/${key}`;
}

function parseGallery(value: string, baseUrl?: string): ProjectSummary["gallery"] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) =>
      typeof item === "object" && item !== null && typeof item.slot === "number" && typeof item.key === "string"
        ? [
            {
              slot: item.slot,
              url: publicImageUrl(item.key, typeof item.publicKey === "string" ? item.publicKey : null, baseUrl),
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}

const avatarUrl = discordAvatarUrl;

function toSummary(row: ProjectRow, publicAssetsBaseUrl?: string): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    author: {
      id: row.author_id,
      name: row.author_name,
      avatarUrl: avatarUrl(row.author_id, row.author_avatar),
    },
    projectType: row.project_type,
    includedTypes: parseIncludedTypes(row.included_types),
    tags: parseTags(row.tags),
    entries: {
      worldbook: row.worldbook_count,
      regex: row.regex_count,
    },
    schemaVersion: row.schema_version,
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
    coverUrl: row.cover_key ? publicImageUrl(row.cover_key, row.public_cover_key, publicAssetsBaseUrl) : null,
    gallery: parseGallery(row.gallery, publicAssetsBaseUrl),
    visibility: row.visibility,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    publishedVersionId: row.published_version_id,
  };
}

function toDetail(
  row: ProjectRow,
  collections: ProjectDetail["collections"],
  publicAssetsBaseUrl?: string,
): ProjectDetail {
  return {
    ...toSummary(row, publicAssetsBaseUrl),
    requirements: parseRequirements(row.requirements),
    discordThreadUrl: row.discord_thread_url,
    collections,
  };
}

interface CatalogCursor {
  scope: string;
  asOf: string;
  value: string | number;
  id: string;
  total: number;
}

function cursorScope(query: ProjectListQuery): Promise<string> {
  return sha256Hex(
    JSON.stringify([
      query.sort,
      query.sort === "likes" || query.sort === "downloads" ? (query.period ?? "30d") : "all",
      query.projectType,
      query.includeContained,
      query.authorId ?? null,
      query.collectionId ?? null,
      query.tag,
      query.search ?? null,
    ]),
  );
}

function encodeCursor(cursor: CatalogCursor): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor))));
}

function decodeCursor(cursor: string | undefined, query: ProjectListQuery, scope: string): CatalogCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0))),
    ) as Partial<CatalogCursor>;
    const numeric = query.sort === "likes" || query.sort === "downloads";
    if (
      parsed.scope === scope &&
      typeof parsed.id === "string" &&
      typeof parsed.asOf === "string" &&
      Number.isFinite(Date.parse(parsed.asOf)) &&
      new Date(parsed.asOf).toISOString() === parsed.asOf &&
      typeof parsed.total === "number" &&
      Number.isSafeInteger(parsed.total) &&
      parsed.total >= 0 &&
      (numeric ? typeof parsed.value === "number" && Number.isFinite(parsed.value) : typeof parsed.value === "string")
    ) {
      return parsed as CatalogCursor;
    }
  } catch {
    return null;
  }
  return null;
}

export async function isValidProjectListCursor(query: ProjectListQuery): Promise<boolean> {
  return !query.cursor || decodeCursor(query.cursor, query, await cursorScope(query)) !== null;
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

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function searchSource(search: string): {
  from: string;
  bindings: unknown[];
  extraWhere?: { sql: string; bindings: unknown[] };
} {
  const trimmed = search.replaceAll("\u0000", " ").trim();
  if (!trimmed) {
    return {
      from: "(SELECT rowid FROM project_search_short WHERE 0) hits CROSS JOIN projects p ON p.rowid = hits.rowid",
      bindings: [],
    };
  }
  const chars = Array.from(trimmed);
  const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
  if (chars.length > 2) {
    // CROSS JOIN keeps the FTS hits outermost, avoiding a catalogue scan for rare terms.
    return {
      from: "(SELECT rowid FROM project_search WHERE project_search MATCH ?) hits CROSS JOIN projects p ON p.rowid = hits.rowid",
      bindings: [quote(trimmed)],
    };
  }
  const wordChars = chars.filter((char) => WORD_CHAR.test(char));
  if (wordChars.length === 0) {
    return {
      from: "(SELECT rowid FROM project_search_short WHERE 0) hits CROSS JOIN projects p ON p.rowid = hits.rowid",
      bindings: [],
    };
  }
  const match = quote(wordChars.join(" "));
  if (wordChars.length === chars.length) {
    return {
      from: "(SELECT rowid FROM project_search_short WHERE project_search_short MATCH ?) hits CROSS JOIN projects p ON p.rowid = hits.rowid",
      bindings: [match],
    };
  }
  const needle = trimmed.toLowerCase();
  return {
    from: "(SELECT rowid FROM project_search_short WHERE project_search_short MATCH ?) hits CROSS JOIN projects p ON p.rowid = hits.rowid",
    bindings: [match],
    extraWhere: {
      sql: `(
        instr(lower(r.title), ?) > 0
        OR instr(lower(r.project_type), ?) > 0
        OR EXISTS (SELECT 1 FROM json_each(r.included_types) WHERE instr(lower(value), ?) > 0)
        OR EXISTS (
          SELECT 1 FROM users u2
          WHERE u2.id = p.author_id
            AND (instr(lower(COALESCE(u2.global_name, '')), ?) > 0 OR instr(lower(u2.username), ?) > 0)
        )
        OR EXISTS (
          SELECT 1 FROM project_search_tags pst
          WHERE pst.project_id = p.id AND instr(lower(pst.tag), ?) > 0
        )
      )`,
      bindings: [needle, needle, needle, needle, needle, needle],
    },
  };
}

export async function listPublishedProjects(
  db: D1Database,
  query: ProjectListQuery,
  publicAssetsBaseUrl?: string,
  onMeta?: (meta: { rows_read: number; rows_written: number }) => void,
) {
  const scope = await cursorScope(query);
  const cursor = decodeCursor(query.cursor, query, scope);
  if (query.cursor && !cursor) throw new Error("Invalid catalog cursor");
  const asOf = cursor?.asOf ?? new Date().toISOString();
  const period = query.period ?? "30d";
  const periodic = period !== "all" && (query.sort === "likes" || query.sort === "downloads");
  const where = [PUBLIC_PROJECT];
  const search = query.search ? searchSource(query.search) : null;
  const filterFrom = `FROM ${search?.from ?? PROJECT_SOURCE} JOIN project_versions r ON r.id = p.published_version_id`;
  const bindings: unknown[] = search ? [...search.bindings] : [];
  if (search?.extraWhere) {
    where.push(search.extraWhere.sql);
    bindings.push(...search.extraWhere.bindings);
  }

  if (query.projectType.length > 0) {
    if (query.includeContained) {
      for (const type of query.projectType) {
        where.push("(r.project_type = ? OR EXISTS (SELECT 1 FROM json_each(r.included_types) WHERE value = ?))");
        bindings.push(type, type);
      }
    } else {
      const placeholders = query.projectType.map(() => "?").join(", ");
      where.push(`r.project_type IN (${placeholders})`);
      bindings.push(...query.projectType);
    }
  }
  if (query.authorId) {
    where.push("p.author_id = ?");
    bindings.push(query.authorId);
  }
  if (query.collectionId) {
    where.push(
      `EXISTS (
        SELECT 1
        FROM collection_projects cp
        JOIN collections c ON c.id = cp.collection_id
        WHERE cp.collection_id = ? AND cp.project_id = p.id AND c.deleted_at IS NULL
      )`,
    );
    bindings.push(query.collectionId);
  }
  const tagGroups: Record<string, string[]> = Object.create(null);
  for (const tag of query.tag) {
    const group = presetTagGroup(tag);
    const key = group === null ? `custom:${tag}` : `preset:${group}`;
    tagGroups[key] ??= [];
    tagGroups[key].push(tag);
  }
  for (const tags of Object.values(tagGroups)) {
    where.push(
      `EXISTS (SELECT 1 FROM project_search_tags WHERE project_id = p.id AND tag IN (${tags.map(() => "?").join(", ")}))`,
    );
    bindings.push(...tags);
  }

  const count = cursor
    ? null
    : db.prepare(`SELECT COUNT(*) AS total ${filterFrom} WHERE ${where.join(" AND ")}`).bind(...bindings);
  let metricJoin = "";
  if (periodic) {
    const days = Number.parseInt(period, 10);
    const end = asOf.slice(0, 10);
    const start = new Date(Date.parse(`${end}T00:00:00.000Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const metric = query.sort === "likes" ? "likes_delta" : "downloads";
    metricJoin = `LEFT JOIN (SELECT project_id, SUM(${metric}) AS score FROM project_metrics_daily
      WHERE day_key >= ? AND day_key <= ? GROUP BY project_id) metric ON metric.project_id = p.id`;
    bindings.splice(search ? search.bindings.length : 0, 0, start, end);
  }
  const column = periodic ? "COALESCE(metric.score, 0)" : SORT_COLUMN[query.sort];
  if (cursor) {
    where.push(`(${column} < ? OR (${column} = ? AND p.id < ?))`);
    bindings.push(cursor.value, cursor.value, cursor.id);
  }
  const outerSelect = periodic
    ? SELECT_PROJECT.replace("p.id,", "paged.sort_val AS catalog_score, p.id,")
    : SELECT_PROJECT;
  const page = db
    .prepare(`${outerSelect}
      FROM (
        SELECT p.id, ${column} AS sort_val
        ${filterFrom} ${metricJoin}
        WHERE ${where.join(" AND ")}
        ORDER BY ${column} DESC, p.id DESC
        LIMIT ?
      ) paged
      CROSS JOIN projects p ON p.id = paged.id
      CROSS JOIN project_versions r ON r.id = p.published_version_id
      CROSS JOIN users u ON u.id = p.author_id
      ORDER BY paged.sort_val DESC, paged.id DESC`)
    .bind(...bindings, query.limit + 1);
  // Keep the first page and its exact count in the same D1 batch.
  const results = count ? await db.batch([page, count]) : [await page.all()];
  const result = results[0]!;
  const countResult = results[1];
  onMeta?.({
    rows_read: result.meta.rows_read + (countResult?.meta.rows_read ?? 0),
    rows_written: result.meta.rows_written + (countResult?.meta.rows_written ?? 0),
  });
  const rows = (result.results as unknown as ProjectRow[]).slice(0, query.limit);
  const hasMore = result.results.length > query.limit;
  const last = rows.at(-1);
  const total = cursor?.total ?? (countResult?.results[0] as { total?: unknown } | undefined)?.total;
  if (typeof total !== "number") throw new Error("Invalid catalog count");
  return projectListResponseSchema.parse({
    items: rows.map((row) => toSummary(row, publicAssetsBaseUrl)),
    total,
    nextCursor:
      hasMore && last
        ? encodeCursor({ scope, asOf, value: sortValue(last, query.sort, periodic), id: last.id, total })
        : null,
  });
}

export async function getPublishedProject(db: D1Database, id: string, publicAssetsBaseUrl?: string) {
  const row = await db
    .prepare(`${SELECT_PROJECT} FROM ${PROJECT_SOURCE} ${PROJECT_JOINS} WHERE p.id = ? AND ${PUBLIC_PROJECT}`)
    .bind(id)
    .first<ProjectRow>();
  if (!row) return null;
  const collections = await listPublicCollectionsForProject(db, row.id);
  return projectDetailSchema.parse(toDetail(row, collections, publicAssetsBaseUrl));
}

export async function getPublishedProjectsByIds(db: D1Database, ids: string[], publicAssetsBaseUrl?: string) {
  if (ids.length === 0) return new Map<string, ProjectSummary>();
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `${SELECT_PROJECT} FROM ${PROJECT_SOURCE} ${PROJECT_JOINS} WHERE p.id IN (${placeholders}) AND ${PUBLIC_PROJECT}`,
    )
    .bind(...ids)
    .all<ProjectRow>();
  return new Map(result.results.map((row) => [row.id, toSummary(row, publicAssetsBaseUrl)]));
}
