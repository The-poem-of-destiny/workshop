import { Hono } from "hono";
import { healthResponseSchema } from "@workshop/contracts";
import type { Env } from "./env";
import { jsonError } from "./http/errors";
import { adminRoutes } from "./http/routes/admin";
import { authRoutes, sessionRoutes } from "./http/routes/auth";
import { authoringRoutes } from "./http/routes/authoring";
import { homeRoutes } from "./http/routes/home";
import { meRoutes } from "./http/routes/me";
import { projectsRoutes } from "./http/routes/projects";
import { recommendationRoutes } from "./http/routes/recommendations";
import { referenceRoutes } from "./http/routes/references";
import { siteRoutes } from "./http/routes/site";

export const app = new Hono<{ Bindings: Env }>();

app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/sessions", sessionRoutes);
app.route("/api/v1/me", meRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/projects", authoringRoutes);
app.route("/api/v1/projects", projectsRoutes);
app.route("/api/v1/home", homeRoutes);
app.route("/api/v1/recommendations", recommendationRoutes);
app.route("/api/v1/reference-sets", referenceRoutes);
app.route("/api/v1/site", siteRoutes);

app.get("/api/v1/assets/*", async c => {
  const key = c.req.path.replace("/api/v1/assets/", "");
  if (!key.startsWith("covers/") && !key.startsWith("banners/")) {
    return jsonError(c, "not_found", "Asset not found");
  }
  const object = await c.env.R2.get(key);
  if (!object) return jsonError(c, "not_found", "Asset not found");
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "content-length": String(object.size),
      "cache-control": "public, max-age=60, must-revalidate",
    },
  });
});

app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("x-content-type-options", "nosniff");
  c.res.headers.set("referrer-policy", "same-origin");
  c.res.headers.set("cache-control", "private, no-store");
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
