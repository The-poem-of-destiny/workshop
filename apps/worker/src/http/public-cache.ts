import { projectListQuerySchema } from "@workshop/contracts";

const CANONICAL_PUBLIC_ORIGIN = "https://public.workshop.invalid";
const TRACKING_PARAMETERS: Record<string, true> = { fbclid: true, gclid: true, mc_cid: true, mc_eid: true };
const PROJECT_LIST_PARAMETERS: Record<string, true> = {
  limit: true,
  cursor: true,
  sort: true,
  period: true,
  projectType: true,
  authorId: true,
  tag: true,
  search: true,
};
const RANKING_PARAMETERS: Record<string, true> = { kind: true };
const RANKING_KINDS: Record<string, true> = { daily: true, "7d": true, "30d": true };
const NO_PARAMETERS: Record<string, never> = {};

export interface PublicCacheProps {
  publicEpoch: string;
}

export type PublicRequest =
  | { kind: "private" }
  | { kind: "invalid" }
  | {
      kind: "public";
      request: Request;
    };

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

function canonicalProjectListSearch(source: URLSearchParams): URLSearchParams | null {
  const values = Object.fromEntries(source);
  for (const [name] of source) {
    if (isTrackingParameter(name)) continue;
    if (!PROJECT_LIST_PARAMETERS[name] || source.getAll(name).length !== 1) return null;
  }
  const parsed = projectListQuerySchema.safeParse(values);
  if (!parsed.success) return null;

  const query = new URLSearchParams();
  if (parsed.data.limit !== 25) query.set("limit", String(parsed.data.limit));
  if (parsed.data.sort !== "updated") query.set("sort", parsed.data.sort);
  if (parsed.data.period && parsed.data.period !== "all") query.set("period", parsed.data.period);
  if (parsed.data.cursor) query.set("cursor", parsed.data.cursor);
  if (parsed.data.projectType) query.set("projectType", parsed.data.projectType);
  if (parsed.data.authorId) query.set("authorId", parsed.data.authorId);
  if (parsed.data.tag) query.set("tag", parsed.data.tag);
  if (parsed.data.search) query.set("search", parsed.data.search);
  query.sort();
  return query;
}

function canonicalPublicUrl(request: Request): URL | null | undefined {
  const incoming = new URL(request.url);
  const pathname = incoming.pathname.length > 1 ? incoming.pathname.replace(/\/+$/, "") : incoming.pathname;
  const url = new URL(`${CANONICAL_PUBLIC_ORIGIN}${pathname}`);
  let query: URLSearchParams | null;

  if (pathname === "/api/v1/projects") {
    query = canonicalProjectListSearch(incoming.searchParams);
  } else if (pathname === "/api/v1/projects/rankings") {
    query = canonicalSearch(incoming.searchParams, RANKING_PARAMETERS, { kind: "7d" });
    if (query && query.has("kind") && !RANKING_KINDS[query.get("kind") ?? ""]) return null;
  } else if (
    pathname === "/api/v1/projects/discovery" ||
    pathname === "/api/v1/home" ||
    pathname === "/api/v1/recommendations" ||
    pathname === "/api/v1/reference-sets" ||
    pathname === "/api/v1/site" ||
    /^\/api\/v1\/projects\/[^/]+(?:\/entries)?$/.test(pathname) ||
    /^\/api\/v1\/reference-sets\/[^/]+$/.test(pathname) ||
    /^\/api\/v1\/assets\/(?:covers|banners)\/.+/.test(pathname) ||
    /^\/client\/checker\/v\/[a-f0-9]{8,64}\/(?:browser-checker\.js|upload-checker\.mjs|review-checker\.mjs|manifest\.json|NOTICES\.txt)$/.test(
      pathname,
    )
  ) {
    query = canonicalSearch(incoming.searchParams, NO_PARAMETERS);
  } else {
    return undefined;
  }

  if (!query) return null;
  url.search = query.toString();
  return url;
}

export function canonicalPublicRequest(request: Request): PublicRequest {
  if (request.method !== "GET" && request.method !== "HEAD") return { kind: "private" };
  const url = canonicalPublicUrl(request);
  if (url === undefined) return { kind: "private" };
  if (!url) return { kind: "invalid" };
  return {
    kind: "public",
    request: new Request(url, {
      method: request.method,
    }),
  };
}

export async function readPublicEpoch(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      .prepare("SELECT value FROM site_settings WHERE key = 'cache_epoch'")
      .first<{ value: string }>();
    return row?.value && /^\d+$/.test(row.value) ? row.value : null;
  } catch {
    return null;
  }
}
