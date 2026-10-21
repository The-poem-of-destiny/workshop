import type { Context } from "hono";
import type { Env } from "../env";

const CACHE_TTL_SECONDS = 30;

interface WorkerCache {
  match: Cache["match"];
  put: Cache["put"];
}

function defaultCache(): WorkerCache | null {
  if (typeof caches === "undefined") return null;
  const candidate: unknown = Reflect.get(caches, "default");
  if (
    candidate
    && typeof candidate === "object"
    && "match" in candidate
    && "put" in candidate
    && typeof candidate.match === "function"
    && typeof candidate.put === "function"
  ) {
    return candidate as WorkerCache;
  }
  return null;
}

async function cacheEpoch(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT value FROM site_settings WHERE key = 'cache_epoch'")
    .first<{ value: string }>();
  return row?.value ?? "0";
}

export async function publicJson<T>(
  c: Context<{ Bindings: Env }>,
  tag: string,
  produce: () => Promise<T>,
): Promise<Response> {
  const cache = defaultCache();
  const epoch = await cacheEpoch(c.env.DB);
  const keyUrl = new URL(c.req.url);
  keyUrl.pathname = `/__public-cache/${epoch}${keyUrl.pathname}`;
  const key = new Request(keyUrl.toString(), { method: "GET" });
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=${CACHE_TTL_SECONDS}`,
    "cloudflare-cdn-cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
    "cache-tag": tag,
  });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) {
      const body = await hit.text();
      headers.set("x-cache", "HIT");
      return new Response(body, { status: 200, headers });
    }
  }
  const value = await produce();
  headers.set("x-cache", "MISS");
  const response = new Response(JSON.stringify(value), { status: 200, headers });
  if (cache) {
    try {
      c.executionCtx.waitUntil(cache.put(key, new Response(JSON.stringify(value), { headers })));
    } catch {
      // Direct route tests have no ExecutionContext.
    }
  }
  return response;
}
