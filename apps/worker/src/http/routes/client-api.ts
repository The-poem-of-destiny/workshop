import { Hono } from "hono";
import type { Env } from "../../env";
import { getClientChannel } from "../../storage/client.js";
import { jsonError } from "../errors.js";

export const clientApiRoutes = new Hono<{ Bindings: Env }>();

clientApiRoutes.use("*", async (c, next) => {
  await next();
  c.header("access-control-allow-origin", "*");
  c.header("cache-control", "no-store");
});

clientApiRoutes.get("/compatibility", async (c) => {
  const channel = c.req.query("channel") ?? "stable";
  if (channel !== "stable" && channel !== "staging") {
    return jsonError(c, "not_found", "Client channel not found");
  }
  const current = await getClientChannel(c.env.DB, channel);
  const version = c.req.query("version");
  if (!current) {
    return c.json({ compatible: true, bootstrap: true, channel, required: null });
  }
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
