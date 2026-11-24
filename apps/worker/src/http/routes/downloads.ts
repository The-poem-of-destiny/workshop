import { Hono } from "hono";
import { dataClient } from "../../data-client.js";
import type { Env } from "../../env";
import { jsonError } from "../errors.js";
import { sessionToken } from "../session.js";
import { TURNSTILE_REQUIRED_MESSAGE, verifyTurnstileRequest } from "../turnstile.js";

export const downloadRoutes = new Hono<{ Bindings: Env }>();

downloadRoutes.get("/:projectId/:versionId/:kind", async (c) => {
  const token = sessionToken(c);
  if (!token) return jsonError(c, "unauthorized", "Login required");
  const verified = await verifyTurnstileRequest(c);
  if (!verified.ok) return jsonError(c, "turnstile_required", TURNSTILE_REQUIRED_MESSAGE);
  return dataClient(c.executionCtx).fetch(c.req.raw);
});
