import { Hono } from "hono";
import { dataClient } from "../../data-client";
import type { Env } from "../../env";
import { jsonError } from "../errors.js";

export const clientApiRoutes = new Hono<{ Bindings: Env }>();

clientApiRoutes.use("*", async (c, next) => {
  await next();
  c.header("access-control-allow-origin", "*");
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
});

clientApiRoutes.get("/version", async (c) => {
  const channel = c.req.query("channel") ?? "stable";
  if (channel !== "stable" && channel !== "staging") {
    return jsonError(c, "not_found", "Client channel not found");
  }
  const current = await dataClient(c.executionCtx).distributionClientChannel(channel);
  if (!current) return jsonError(c, "not_found", "Client channel not found");
  c.header("cache-control", "public, max-age=5, stale-if-error=0");
  return c.json({ channel, ...current });
});

clientApiRoutes.get("/compatibility", async (c) => {
  const channel = c.req.query("channel") ?? "stable";
  if (channel !== "stable" && channel !== "staging") {
    return jsonError(c, "not_found", "Client channel not found");
  }
  const current = await dataClient(c.executionCtx).distributionClientChannel(channel);
  const version = c.req.query("version");
  if (!current) {
    return c.json({
      compatible: false,
      bootstrap: true,
      channel,
      required: null,
      revision: null,
      reason: "channel_unavailable",
    });
  }
  c.header("cache-control", "public, max-age=5, stale-if-error=0");
  const compatible = Boolean(version && version === current.version);
  return c.json({
    compatible,
    bootstrap: false,
    channel,
    required: current.version,
    revision: current.revision,
    reason: compatible ? null : version ? "version_mismatch" : "version_required",
  });
});
