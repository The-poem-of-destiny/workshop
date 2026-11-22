import { type ProjectListQuery, projectBatchQuerySchema, projectListQuerySchema } from "@workshop/contracts";

export type PublicCacheClass = "public" | "reference" | "immutable";

export const PUBLIC_READ_PATH = "/public/v1";

type PublicOperation =
  | { kind: "project-list"; query: ProjectListQuery }
  | { kind: "project-batch"; ids: string[] }
  | { kind: "project-detail" | "project-entries" | "collection" | "author"; encodedId: string }
  | { kind: "home" | "site" | "recommendations" }
  | { kind: "image"; key: string }
  | { kind: "client-asset"; asset: ClientAsset };

export type PublicRead = {
  pathname: string;
  search: string;
  category: PublicCacheClass;
  operation: PublicOperation;
};

const JAVASCRIPT_CONTENT_TYPE = "text/javascript; charset=utf-8";
const CHECKER_CONTENT_TYPES: Record<string, string> = {
  "browser-checker.js": JAVASCRIPT_CONTENT_TYPE,
  "upload-checker.mjs": JAVASCRIPT_CONTENT_TYPE,
  "review-checker.mjs": JAVASCRIPT_CONTENT_TYPE,
  "manifest.json": "application/json; charset=utf-8",
  "NOTICES.txt": "text/plain; charset=utf-8",
};

export type ClientAsset = { key: string; contentType: string; immutable: boolean };

export function versionedClientAsset(pathname: string): ClientAsset | undefined {
  if (/^\/client\/v\/[a-f0-9]{8,64}\/index\.js$/.test(pathname)) {
    return { key: pathname.slice(1), contentType: JAVASCRIPT_CONTENT_TYPE, immutable: true };
  }
  const checker = /^\/client\/checker\/v\/([a-f0-9]{8,64})\/([^/]+)$/.exec(pathname);
  const file = checker?.[2];
  if (file && Object.hasOwn(CHECKER_CONTENT_TYPES, file)) {
    return { key: pathname.slice("/client/".length), contentType: CHECKER_CONTENT_TYPES[file]!, immutable: true };
  }
}

export function clientChannelAsset(pathname: string): ClientAsset | undefined {
  if (/^\/client\/(?:stable|staging)\/index\.js$/.test(pathname)) {
    return { key: pathname.slice(1), contentType: JAVASCRIPT_CONTENT_TYPE, immutable: false };
  }
}

const TRACKING_PARAMETERS: Record<string, true> = { fbclid: true, gclid: true, mc_cid: true, mc_eid: true };
const PROJECT_LIST_PARAMETERS: Record<string, true> = {
  limit: true,
  cursor: true,
  sort: true,
  period: true,
  projectType: true,
  includeContained: true,
  authorId: true,
  collectionId: true,
  tag: true,
  search: true,
};
const NO_PARAMETERS: Record<string, never> = {};

export type PublicRequest = { kind: "private" } | { kind: "invalid" } | { kind: "public"; read: PublicRead };

function isTrackingParameter(name: string): boolean {
  return name.startsWith("utm_") || TRACKING_PARAMETERS[name] === true;
}

function canonicalSearch(
  source: URLSearchParams,
  allowed: Readonly<Record<string, true>>,
  defaults: Record<string, string> = {},
): URLSearchParams | null {
  const query = new URLSearchParams();
  for (const [name, value] of source) {
    if (isTrackingParameter(name)) continue;
    if (!allowed[name] || query.has(name)) return null;
    if (defaults[name] !== value) query.set(name, value);
  }
  query.sort();
  return query;
}

function canonicalProjectBatch(source: URLSearchParams): { search: URLSearchParams; ids: string[] } | null {
  for (const [name] of source) {
    if (isTrackingParameter(name)) continue;
    if (name !== "ids" || source.getAll(name).length !== 1) return null;
  }
  const parsed = projectBatchQuerySchema.safeParse({ ids: source.get("ids") ?? undefined });
  if (!parsed.success) return null;
  return { search: new URLSearchParams({ ids: parsed.data.ids.join(",") }), ids: parsed.data.ids };
}

function canonicalProjectList(source: URLSearchParams): { search: URLSearchParams; query: ProjectListQuery } | null {
  const values = {
    ...Object.fromEntries(source),
    projectType: source.getAll("projectType"),
    tag: source.getAll("tag"),
  };
  for (const [name] of source) {
    if (isTrackingParameter(name)) continue;
    if (!PROJECT_LIST_PARAMETERS[name]) return null;
    if (name !== "projectType" && name !== "tag" && source.getAll(name).length !== 1) return null;
  }
  const parsed = projectListQuerySchema.safeParse(values);
  if (!parsed.success) return null;

  const query = new URLSearchParams();
  if (parsed.data.limit !== 25) query.set("limit", String(parsed.data.limit));
  if (parsed.data.sort !== "published") query.set("sort", parsed.data.sort);

  // Omitted defaults must have the same meaning in the cache key and the source query.
  const cursor = parsed.data.cursor || undefined;
  const period =
    (parsed.data.sort === "likes" || parsed.data.sort === "downloads") && parsed.data.period !== "30d"
      ? parsed.data.period
      : undefined;
  if (period) query.set("period", period);
  if (cursor) query.set("cursor", cursor);
  for (const type of parsed.data.projectType) query.append("projectType", type);
  if (parsed.data.includeContained) query.set("includeContained", "true");
  if (parsed.data.authorId) query.set("authorId", parsed.data.authorId);
  if (parsed.data.collectionId) query.set("collectionId", parsed.data.collectionId);
  for (const tag of parsed.data.tag) query.append("tag", tag);
  if (parsed.data.search) query.set("search", parsed.data.search);
  query.sort();
  parsed.data.cursor = cursor;
  parsed.data.period = period;
  return { search: query, query: parsed.data };
}

function publicPath(pathname: string): PublicOperation | undefined {
  switch (pathname) {
    case "/api/v1/home":
      return { kind: "home" };
    case "/api/v1/site":
      return { kind: "site" };
    case "/api/v1/recommendations":
      return { kind: "recommendations" };
  }
  if (pathname.startsWith("/api/v1/projects/")) {
    const project = /^\/api\/v1\/projects\/([^/]+)(\/entries)?$/.exec(pathname);
    if (project) return { kind: project[2] ? "project-entries" : "project-detail", encodedId: project[1]! };
  } else if (pathname.startsWith("/api/v1/collections/")) {
    const collection = /^\/api\/v1\/collections\/([^/]+)$/.exec(pathname);
    if (collection) return { kind: "collection", encodedId: collection[1]! };
  } else if (pathname.startsWith("/api/v1/authors/")) {
    const author = /^\/api\/v1\/authors\/([^/]+)$/.exec(pathname);
    if (author) return { kind: "author", encodedId: author[1]! };
  } else if (/^\/api\/v1\/public-assets\/(?:covers|gallery|banners)\/.+/.test(pathname)) {
    return { kind: "image", key: pathname.slice("/api/v1/public-assets/".length) };
  } else if (pathname.startsWith("/client/")) {
    const asset = versionedClientAsset(pathname);
    if (asset) return { kind: "client-asset", asset };
  }
}

function publicRead(pathname: string, query: URLSearchParams, operation: PublicOperation): PublicRequest {
  const search = query.toString();
  const category = operation.kind === "client-asset" ? "immutable" : operation.kind === "site" ? "reference" : "public";
  return { kind: "public", read: { pathname, search: search ? `?${search}` : "", category, operation } };
}

export function canonicalPublicRequest(method: string, incoming: URL): PublicRequest {
  if (method !== "GET" && method !== "HEAD") return { kind: "private" };
  const pathname = incoming.pathname.length > 1 ? incoming.pathname.replace(/\/+$/, "") : incoming.pathname;
  if (pathname === "/api/v1/projects") {
    const list = canonicalProjectList(incoming.searchParams);
    return list ? publicRead(pathname, list.search, { kind: "project-list", query: list.query }) : { kind: "invalid" };
  }
  if (pathname === "/api/v1/projects/batch") {
    const batch = canonicalProjectBatch(incoming.searchParams);
    return batch ? publicRead(pathname, batch.search, { kind: "project-batch", ids: batch.ids }) : { kind: "invalid" };
  }
  const operation = publicPath(pathname);
  if (!operation) return { kind: "private" };
  const query = canonicalSearch(incoming.searchParams, NO_PARAMETERS);
  return query ? publicRead(pathname, query, operation) : { kind: "invalid" };
}
