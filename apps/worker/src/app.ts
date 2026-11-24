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
import { collectionsRoutes } from "./http/routes/collections";
import { companionRoutes } from "./http/routes/companion";
import { downloadRoutes } from "./http/routes/downloads";
import { meRoutes } from "./http/routes/me";
import { projectsRoutes } from "./http/routes/projects";
import { recommendationRoutes } from "./http/routes/recommendations";
import { siteRoutes } from "./http/routes/site";
import { turnstilePublicConfig } from "./http/turnstile";
import { isStorageQuotaError, quotaErrorDetail, quotaExceededMessage } from "./quota-error";
import {
  hasMaintenanceBearer,
  hasUncertainWrite,
  isMaintenanceUnavailableError,
  maintenanceUnavailable,
} from "./write-barrier";

export const app = new Hono<{ Bindings: Env }>();

const uncertainRequests = new WeakSet<Request>();

export function applicationRequestSettled(request: Request): boolean {
  return !uncertainRequests.delete(request);
}

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
  if (!c.res.headers.has("referrer-policy")) {
    c.res.headers.set("referrer-policy", "same-origin");
  }
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
      "access-control-allow-headers":
        "authorization,content-type,if-match,idempotency-key,x-client-version,x-client-channel,x-turnstile-token",
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
app.post("/api/v1/maintenance/public-images", async (c) => {
  if (!(await hasMaintenanceBearer(c.req.raw, c.env))) return c.body(null, 401);
  const input: unknown = await c.req.json().catch(() => null);
  if (typeof input !== "object" || input === null || !("target" in input)) return c.body(null, 400);
  const target = input.target;
  if (target !== "banner" && target !== "project") return c.body(null, 400);
  const projectId = "projectId" in input ? input.projectId : undefined;
  if (target === "project" && (typeof projectId !== "string" || !projectId || projectId.length > 128)) {
    return c.body(null, 400);
  }
  const result = await dataClient(c.executionCtx).backfillPublicImages(
    target === "banner" ? null : (projectId as string),
  );
  return result ? c.json(result) : c.body(null, 503);
});
app.route("/api/v1/me", meRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/projects", authoringRoutes);
app.route("/api/v1/projects", projectsRoutes);
app.route("/api/v1/collections", collectionsRoutes);
app.route("/api/v1/downloads", downloadRoutes);
// Only path aliases matched by Hono but not the public gateway reach these GETs.
for (const path of [
  "/api/v1/home",
  "/api/v1/recommendations",
  "/api/v1/site",
  "/api/v1/projects",
  "/api/v1/projects/:id",
  "/api/v1/projects/:id/entries",
  "/api/v1/collections/:id",
  "/api/v1/authors/:id",
]) {
  app.get(path, (c) => jsonError(c, "bad_request", "Invalid public query"));
}
app.route("/api/v1/recommendations", recommendationRoutes);
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

app.get("/api/v1/public-assets/*", (c) => dataClient(c.executionCtx).fetch(c.req.raw));
app.get("/api/v1/assets/*", (c) => dataClient(c.executionCtx).fetch(c.req.raw));

app.get("/api/v1/turnstile/config", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json(turnstilePublicConfig(c.env));
});

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

app.notFound((c) => c.text("Not found", 404));

app.onError((error, c) => {
  if (isMaintenanceUnavailableError(error)) {
    return maintenanceUnavailable();
  }
  const quota = isStorageQuotaError(error);
  if (!quota || hasUncertainWrite(error)) {
    // Hono may replace the error response (e.g. HEAD); track the request instead.
    uncertainRequests.add(c.req.raw);
  }
  console.error("Unhandled worker error", error);
  if (quota) {
    return jsonError(c, "quota_exceeded", quotaExceededMessage(), quotaErrorDetail(error));
  }
  return jsonError(c, "internal", "Internal server error");
});
