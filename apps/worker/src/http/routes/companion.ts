import { companionScriptIdSchema, companionVersionInputSchema, companionVersionSchema } from "@workshop/contracts";
import { Hono } from "hono";
import type { Env } from "../../env.js";
import { getCompanionVersion, publishCompanionVersion } from "../../storage/companion.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";

export const companionRoutes = new Hono<{ Bindings: Env }>();

companionRoutes.use("*", async (c, next) => {
  c.header("cache-control", "private, no-store");
  await next();
});

companionRoutes.get("/:scriptId", async (c) => {
  const id = companionScriptIdSchema.safeParse(c.req.param("scriptId"));
  if (!id.success) return jsonError(c, "bad_request", "Invalid companion script identifier");
  const record = await getCompanionVersion(c.env.DB, id.data);
  return record ? c.json(record) : jsonError(c, "not_found", "Companion script not found");
});

companionRoutes.get("/:scriptId/versions/:version", async (c) => {
  const id = companionScriptIdSchema.safeParse(c.req.param("scriptId"));
  const version = companionVersionSchema.safeParse(c.req.param("version"));
  if (!id.success || !version.success) return jsonError(c, "bad_request", "Invalid companion version identifier");
  const record = await getCompanionVersion(c.env.DB, id.data, version.data);
  return record ? c.json(record) : jsonError(c, "not_found", "Companion version not found");
});

companionRoutes.put("/:scriptId/versions/:version", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  if (session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const id = companionScriptIdSchema.safeParse(c.req.param("scriptId"));
  const version = companionVersionSchema.safeParse(c.req.param("version"));
  let body: unknown;
  try {
    body = await c.req.json<unknown>();
  } catch {
    body = undefined;
  }
  const input = companionVersionInputSchema.safeParse(body);
  if (!id.success || !version.success || !input.success) {
    return jsonError(c, "bad_request", "Invalid companion version registration");
  }
  const result = await publishCompanionVersion(c.env.DB, session.userId, id.data, version.data, input.data);
  if (result.status === "conflict") return jsonError(c, "conflict", "Companion version is immutable");
  return c.json(result.record, result.status === "created" ? 201 : 200);
});
