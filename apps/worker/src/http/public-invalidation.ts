import { cache } from "cloudflare:workers";

export const PROJECT_PROJECTIONS = [
  "/api/v1/projects",
  "/api/v1/home",
  "/api/v1/recommendations",
  "/api/v1/public-assets/",
];

// Best effort acceleration, not a commit barrier. The 300s response lifetime
// remains the bound on fresh cached representations when purge is unavailable.
export async function purgePublicPaths(pathPrefixes: string[]): Promise<void> {
  try {
    const result = await cache.purge({ pathPrefixes });
    if (!result.success) console.error("Public cache purge rejected", result.errors);
  } catch (error) {
    console.error("Public cache purge failed", error);
  }
}

export function publicWritePaths(request: Request): string[] {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return [];
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/v1/site")) return ["/api/v1/site", "/api/v1/home", "/api/v1/public-assets/banners/"];
  if (path.startsWith("/api/v1/admin/reference-sets")) return ["/api/v1/reference-sets"];
  if (path.startsWith("/api/v1/admin/recommendations")) return ["/api/v1/recommendations", "/api/v1/home"];
  if (/^\/api\/v1\/admin\/submissions\/[^/]+\/review$/.test(path)) return PROJECT_PROJECTIONS;
  // Draft creation, revision uploads, likes, counts and private state do not
  // invalidate public pages. Display edits, withdrawal and gallery edits do.
  if (
    /^\/api\/v1\/projects\/[^/]+(?:\/visibility|\/gallery\/[^/]+)?$/.test(path) &&
    ["PATCH", "DELETE", "PUT"].includes(request.method)
  )
    return PROJECT_PROJECTIONS;
  return [];
}
