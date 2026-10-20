import { Hono } from "hono";
import { healthResponseSchema } from "@workshop/contracts";
import type { Env } from "./env";
import { jsonError } from "./http/errors";

export const app = new Hono<{ Bindings: Env }>();

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
