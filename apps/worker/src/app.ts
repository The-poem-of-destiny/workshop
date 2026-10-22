import { healthResponseSchema } from "@workshop/contracts";
import { Hono } from "hono";
import type { Env } from "./env";
import { jsonError } from "./http/errors";
import { shouldSampleRequest } from "./http/observability";
import { adminRoutes } from "./http/routes/admin";
import { authRoutes, sessionRoutes } from "./http/routes/auth";
import { authoringRoutes } from "./http/routes/authoring";
import { clientRoutes } from "./http/routes/client";
import { clientApiRoutes } from "./http/routes/client-api";
import { downloadRoutes } from "./http/routes/downloads";
import { homeRoutes } from "./http/routes/home";
import { meRoutes } from "./http/routes/me";
import { projectsRoutes } from "./http/routes/projects";
import { recommendationRoutes } from "./http/routes/recommendations";
import { referenceRoutes } from "./http/routes/references";
import { siteRoutes } from "./http/routes/site";
import { requireSession } from "./http/session";

export const app = new Hono<{ Bindings: Env }>();

// Register before routes: Hono wildcard middleware only runs for handlers
// registered after it.
app.use("*", async (c, next) => {
  const started = Date.now();
  await next();
  const rate = Number(c.env.LOG_SAMPLE_RATE ?? "0.1");
  if (shouldSampleRequest(c.res.status, rate, Math.random())) {
    const entry = {
      event: "request",
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs: Date.now() - started,
      sampled: c.res.status < 500,
    };
    console.log(JSON.stringify(entry));
  }
  c.res.headers.set("x-content-type-options", "nosniff");
  c.res.headers.set("referrer-policy", "same-origin");
  if (!c.res.headers.has("cache-control")) {
    c.res.headers.set("cache-control", "private, no-store");
  }
});

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("origin");
  const allowed = (c.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigin = origin && allowed.includes(origin) ? origin : null;
  if (c.req.method === "OPTIONS") {
    if (!allowedOrigin) return c.body(null, 403);
    return c.body(null, 204, {
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,if-match,x-client-version,x-client-channel",
      "access-control-max-age": "600",
      vary: "Origin",
    });
  }
  await next();
  if (allowedOrigin) {
    c.res.headers.set("access-control-allow-origin", allowedOrigin);
    c.res.headers.set("vary", "Origin");
  }
});

app.route("/client", clientRoutes);
app.route("/api/v1/client", clientApiRoutes);
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/sessions", sessionRoutes);
app.route("/api/v1/me", meRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/projects", authoringRoutes);
app.route("/api/v1/projects", projectsRoutes);
app.route("/api/v1/downloads", downloadRoutes);
app.route("/api/v1/home", homeRoutes);
app.route("/api/v1/recommendations", recommendationRoutes);
app.route("/api/v1/reference-sets", referenceRoutes);
app.route("/api/v1/site", siteRoutes);

app.get("/test-dist/CreativeWorkshop/index.js", (c) => {
  const origin = (c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin).replace(/\/+$/, "");
  const script = `(() => {
  console.warn("[CreativeWorkshop] 旧导入地址已迁移到 ${origin}/client/stable/index.js，请更新脚本导入地址。");
  import(${JSON.stringify(`${origin}/client/stable/index.js`)}).catch(error => console.error("[CreativeWorkshop] legacy shim load failed", error));
})();`;
  return new Response(script, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    },
  });
});

app.get("/assets/*", async (c) => {
  if (!c.env.ASSETS) return c.text("Not found", 404);
  const response = await c.env.ASSETS.fetch(c.req.raw);
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, { status: response.status, headers });
});

app.get("/api/v1/assets/*", async (c) => {
  const key = c.req.path.replace("/api/v1/assets/", "");
  if (!key.startsWith("covers/") && !key.startsWith("banners/")) {
    return jsonError(c, "not_found", "Asset not found");
  }

  let publiclyCacheable = false;
  if (key.startsWith("covers/")) {
    // A content-addressed R2 key can be associated with more than one asset.
    // Resolve authorization by a currently permitted association, rather than
    // whichever joined row SQLite happens to return first.
    const publicAssociation = await c.env.DB.prepare(`
      SELECT EXISTS (
        SELECT 1
        FROM assets a
        JOIN projects p ON p.id = a.project_id
        WHERE a.r2_key = ? AND a.kind = 'cover'
          AND p.deleted_at IS NULL
          AND p.visibility = 'public'
          AND p.published_revision_id IS NOT NULL
          AND (
            (a.id = p.published_cover_asset_id AND a.revision_id IS NULL)
            OR (
              p.published_cover_asset_id IS NULL
              AND a.revision_id = p.published_revision_id
            )
          )
      ) AS permitted
    `)
      .bind(key)
      .first<{ permitted: number }>();
    publiclyCacheable = Boolean(publicAssociation?.permitted);

    if (!publiclyCacheable) {
      const session = await requireSession(c);
      if (!session) return jsonError(c, "not_found", "Asset not found");
      const privateAssociation = await c.env.DB.prepare(`
        SELECT EXISTS (
          SELECT 1
          FROM assets a
          JOIN projects p ON p.id = a.project_id
          WHERE a.r2_key = ? AND a.kind = 'cover' AND p.deleted_at IS NULL
            AND (
              (
                (p.author_id = ? OR ? = 'owner')
                AND (a.revision_id = p.working_revision_id OR a.id = p.published_cover_asset_id)
              )
              OR (
                ? IN ('reviewer', 'owner')
                AND a.revision_id IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM submissions s
                  WHERE s.revision_id = a.revision_id
                    AND s.status IN ('pending', 'checking')
                )
              )
            )
        ) AS permitted
      `)
        .bind(key, session.userId, session.role, session.role)
        .first<{ permitted: number }>();
      if (!privateAssociation?.permitted) return jsonError(c, "not_found", "Asset not found");
    }
  } else {
    const registered = await c.env.DB.prepare("SELECT value FROM site_settings WHERE key = 'discover_banner'").first<{
      value: string;
    }>();
    let registeredKey: string | null = null;
    try {
      const parsed = registered ? (JSON.parse(registered.value) as { imageUrl?: unknown }) : null;
      if (typeof parsed?.imageUrl === "string") {
        const pathname = parsed.imageUrl.startsWith("http") ? new URL(parsed.imageUrl).pathname : parsed.imageUrl;
        registeredKey = pathname.replace(/^\/api\/v1\/assets\//, "");
      }
    } catch {
      registeredKey = null;
    }
    if (registeredKey !== key) return jsonError(c, "not_found", "Asset not found");
  }

  const object = await c.env.R2.get(key);
  if (!object) return jsonError(c, "not_found", "Asset not found");
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "content-length": String(object.size),
      "cache-control": "private, no-store",
      vary: "Authorization",
    },
  });
});

app.get("/api/v1/health", (c) => {
  const body = healthResponseSchema.parse({
    ok: true,
    service: "workshop",
    version: c.env.APP_VERSION ?? "dev",
    bindings: {
      db: Boolean(c.env.DB),
      r2: Boolean(c.env.R2),
      assets: Boolean(c.env.ASSETS),
    },
  });
  return c.json(body);
});

// Registered before the API catch-all so an unknown /api path is JSON, not the
// text 404 that non-API routes use.
app.all("/api/*", (c) => jsonError(c, "not_found", "Not found"));

app.get("/", (c) => c.text("workshop", 200, { "content-type": "text/plain; charset=utf-8" }));

app.notFound((c) => c.text("Not found", 404));

app.onError((error, c) => {
  console.error("Unhandled worker error", error);
  return jsonError(c, "internal", "Internal server error");
});
