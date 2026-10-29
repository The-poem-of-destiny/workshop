import { healthResponseSchema } from "@workshop/contracts";
import { Hono } from "hono";
import { dataClient } from "./data-client";
import type { Env } from "./env";
import { jsonError } from "./http/errors";
import { shouldSampleRequest } from "./http/observability";
import { adminRoutes } from "./http/routes/admin";
import { authRoutes, sessionRoutes } from "./http/routes/auth";
import { authoringRoutes } from "./http/routes/authoring";
import { clientRoutes } from "./http/routes/client";
import { clientApiRoutes } from "./http/routes/client-api";
import { companionRoutes } from "./http/routes/companion";
import { downloadRoutes } from "./http/routes/downloads";
import { homeRoutes } from "./http/routes/home";
import { meRoutes } from "./http/routes/me";
import { projectsRoutes } from "./http/routes/projects";
import { recommendationRoutes } from "./http/routes/recommendations";
import { referenceRoutes } from "./http/routes/references";
import { siteRoutes } from "./http/routes/site";

export const app = new Hono<{ Bindings: Env }>();

// Register before routes: Hono wildcard middleware only runs for handlers
// registered after it.
app.use("*", async (c, next) => {
  const started = Date.now();
  await next();
  c.res = new Response(c.res.body, c.res);
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
  c.res = new Response(c.res.body, c.res);
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
app.route("/api/v1/companion-scripts", companionRoutes);

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

app.get("/api/v1/public-assets/*", (c) => dataClient(c.executionCtx).fetch(c.req.raw));
app.get("/api/v1/assets/*", (c) => dataClient(c.executionCtx).fetch(c.req.raw));

app.get("/api/v1/health", async (c) => {
  const body = healthResponseSchema.parse({
    ok: true,
    service: "workshop",
    version: c.env.APP_VERSION ?? "dev",
    bindings: {
      ...(await dataClient(c.executionCtx).healthBindings()),
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
