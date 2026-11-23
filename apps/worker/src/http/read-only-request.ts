// The gateway handles canonical public requests and static assets separately.
// Match canonical Hono read routes here, not aliases or whole route families:
// session lookup can renew a session and polling OAuth can expire a flow.
export function isReadOnlyRequest(method: string, pathname: string): boolean {
  if (method === "OPTIONS" && pathname.startsWith("/api/")) return true;
  // Hono dispatches HEAD through the corresponding GET handler.
  if (method !== "GET" && method !== "HEAD") return false;

  switch (pathname) {
    case "/api/v1/health":
    case "/api/v1/client/version":
    case "/api/v1/client/compatibility":
    case "/client/stable/index.js":
    case "/client/staging/index.js":
    case "/test-dist/CreativeWorkshop/index.js":
      return true;
  }

  // Companion metadata validates its segments and only reads site settings.
  if (/^\/api\/v1\/companion-scripts\/[^/%]+(?:\/versions\/[^/%]+)?$/.test(pathname)) return true;

  // Only the legacy banner branch reads the registered public key without a
  // session lookup. Legacy cover and gallery routes can fall back to auth.
  return /^\/api\/v1\/assets\/banners\/[^/%]+$/.test(pathname);
}
