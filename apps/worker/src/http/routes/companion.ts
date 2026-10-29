import { companionScriptIdSchema, companionVersionSchema } from "@workshop/contracts";
import { Hono } from "hono";
import { dataClient } from "../../data-client";
import type { Env } from "../../env.js";
import { jsonError } from "../errors.js";

export const companionRoutes = new Hono<{ Bindings: Env }>();

companionRoutes.use("*", async (c, next) => {
  c.header("cache-control", "private, no-store");
  await next();
});

companionRoutes.get("/:scriptId", async (c) => {
  const id = companionScriptIdSchema.safeParse(c.req.param("scriptId"));
  if (!id.success) return jsonError(c, "bad_request", "Invalid companion script identifier");
  const record = await dataClient(c.executionCtx).distributionCompanion(id.data);
  return record ? c.json(record) : jsonError(c, "not_found", "Companion script not found");
});

companionRoutes.get("/:scriptId/versions/:version", async (c) => {
  const id = companionScriptIdSchema.safeParse(c.req.param("scriptId"));
  const version = companionVersionSchema.safeParse(c.req.param("version"));
  if (!id.success || !version.success) return jsonError(c, "bad_request", "Invalid companion version identifier");
  const record = await dataClient(c.executionCtx).distributionCompanion(id.data, version.data);
  return record ? c.json(record) : jsonError(c, "not_found", "Companion version not found");
});

companionRoutes.put("/:scriptId/versions/:version", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json<unknown>();
  } catch {
    body = undefined;
  }
  const result = await dataClient(c.executionCtx).distributionPublishCompanion(
    c.req.header("authorization"),
    c.req.param("scriptId"),
    c.req.param("version"),
    body,
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "forbidden") return jsonError(c, "forbidden", "Owner role required");
  if (result.kind === "invalid") return jsonError(c, "bad_request", "Invalid companion version registration");
  if (result.data.status === "conflict") return jsonError(c, "conflict", "Companion version is immutable");
  return c.json(result.data.record, result.data.status === "created" ? 201 : 200);
});
