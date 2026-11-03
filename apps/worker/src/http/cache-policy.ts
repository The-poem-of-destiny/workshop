import type { Env } from "../env";

type CacheClass = "public" | "reference" | "immutable" | "internal";

const settings: Record<CacheClass, { key: keyof Env; fallback: number }> = {
  public: { key: "CACHE_TTL_PUBLIC_SECONDS", fallback: 60 },
  reference: { key: "CACHE_TTL_REFERENCE_SECONDS", fallback: 300 },
  immutable: { key: "CACHE_TTL_IMMUTABLE_SECONDS", fallback: 31536000 },
  internal: { key: "CACHE_TTL_INTERNAL_SECONDS", fallback: 86400 },
};

export function cacheTtl(env: Env, category: CacheClass): number {
  const { key, fallback } = settings[category];
  const value = env[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 0;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= 31536000 ? seconds : 0;
}

export function publicCacheClass(path: string): CacheClass {
  if (path.startsWith("/client/")) return "immutable";
  if (path === "/api/v1/site") return "reference";
  return "public";
}
