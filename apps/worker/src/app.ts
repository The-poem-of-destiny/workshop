import { Hono } from "hono";
import { healthResponseSchema } from "@workshop/contracts";
import type { Env } from "./env";
import { jsonError } from "./http/errors";
import { adminRoutes } from "./http/routes/admin";
import { authRoutes, sessionRoutes } from "./http/routes/auth";
import { authoringRoutes } from "./http/routes/authoring";
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
  await next();
  c.res.headers.set("x-content-type-options", "nosniff");
  c.res.headers.set("referrer-policy", "same-origin");
  if (!c.res.headers.has("cache-control")) {
    c.res.headers.set("cache-control", "private, no-store");
  }
});

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

app.get("/api/v1/assets/*", async c => {
  const key = c.req.path.replace("/api/v1/assets/", "");
  if (!key.startsWith("covers/") && !key.startsWith("banners/")) {
    return jsonError(c, "not_found", "Asset not found");
  }

  let publiclyCacheable = false;
  if (key.startsWith("covers/")) {
    const asset = await c.env.DB.prepare(`
      SELECT a.revision_id, a.kind, p.author_id, p.visibility,
             p.working_revision_id, p.published_revision_id, p.deleted_at,
             EXISTS (
               SELECT 1 FROM submissions s
               WHERE s.revision_id = a.revision_id AND s.status IN ('pending', 'checking')
             ) AS in_review
      FROM assets a JOIN projects p ON p.id = a.project_id
      WHERE a.r2_key = ? AND a.kind = 'cover'
    `).bind(key).first<{
      revision_id: string | null;
      kind: string;
      author_id: string;
      visibility: "public" | "private";
      working_revision_id: string | null;
      published_revision_id: string | null;
      deleted_at: string | null;
      in_review: number;
    }>();
    if (!asset) return jsonError(c, "not_found", "Asset not found");

    const isPublished = !asset.deleted_at
      && asset.visibility === "public"
      && asset.published_revision_id !== null
      && asset.revision_id === asset.published_revision_id;
    if (isPublished) {
      publiclyCacheable = true;
    } else {
      const session = await requireSession(c);
      if (!session) return jsonError(c, "not_found", "Asset not found");
      const isOwnDraft = session.userId === asset.author_id
        && asset.revision_id === asset.working_revision_id;
      const isReviewCover = (session.role === "reviewer" || session.role === "owner")
        && Boolean(asset.in_review);
      if (!isOwnDraft && !isReviewCover) return jsonError(c, "not_found", "Asset not found");
    }
  } else {
    const registered = await c.env.DB.prepare("SELECT value FROM site_settings WHERE key = 'discover_banner'")
      .first<{ value: string }>();
    let registeredKey: string | null = null;
    try {
      const parsed = registered ? JSON.parse(registered.value) as { imageUrl?: unknown } : null;
      if (typeof parsed?.imageUrl === "string") {
        const pathname = parsed.imageUrl.startsWith("http")
          ? new URL(parsed.imageUrl).pathname
          : parsed.imageUrl;
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
      "cache-control": publiclyCacheable
        ? "public, max-age=60, must-revalidate"
        : "private, no-store",
      vary: "Authorization",
    },
  });
});

app.get("/api/v1/health", c => {
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
app.all("/api/*", c => jsonError(c, "not_found", "Not found"));

app.get("/", c => c.text("workshop", 200, { "content-type": "text/plain; charset=utf-8" }));

app.notFound(c => c.text("Not found", 404));

app.onError((error, c) => {
  console.error("Unhandled worker error", error);
  return jsonError(c, "internal", "Internal server error");
});
