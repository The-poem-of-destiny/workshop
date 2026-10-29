import {
  authorProjectListResponseSchema,
  authorSubmissionListResponseSchema,
  meResponseSchema,
  meStateResponseSchema,
  ratingInputSchema,
} from "@workshop/contracts";
import { Hono } from "hono";
import type { Env } from "../../env";
import { jsonError } from "../errors.js";
import { sessionToken } from "../session.js";

export const meRoutes = new Hono<{ Bindings: Env }>();

meRoutes.get("/", async (c) => {
  const result = await c.executionCtx.exports.DataService.identityMe(sessionToken(c), { kind: "me" });
  if (!result.ok) return jsonError(c, "unauthorized", "Login required");
  return c.json(meResponseSchema.parse(result.data));
});

meRoutes.get("/projects", async (c) => {
  const result = await c.executionCtx.exports.DataService.identityMe(sessionToken(c), { kind: "projects" });
  if (!result.ok) return jsonError(c, "unauthorized", "Login required");
  return c.json(authorProjectListResponseSchema.parse(result.data));
});

meRoutes.get("/projects/:id/submissions", async (c) => {
  const result = await c.executionCtx.exports.DataService.identityMe(sessionToken(c), {
    kind: "submissions",
    projectId: c.req.param("id"),
  });
  if (!result.ok)
    return result.error === "unauthorized"
      ? jsonError(c, "unauthorized", "Login required")
      : jsonError(c, "not_found", "Project not found");
  return c.json(authorSubmissionListResponseSchema.parse(result.data));
});

meRoutes.get("/subscriptions", async (c) => {
  const result = await c.executionCtx.exports.DataService.identityMe(sessionToken(c), { kind: "subscriptions" });
  if (!result.ok) return jsonError(c, "unauthorized", "Login required");
  return c.json(result.data);
});

meRoutes.get("/state", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const result = await c.executionCtx.exports.DataService.identityMe(sessionToken(c), { kind: "state", ids });
  if (!result.ok)
    return result.error === "too_many_ids"
      ? jsonError(c, "bad_request", "At most 50 project IDs are allowed")
      : jsonError(c, "unauthorized", "Login required");
  return c.json(meStateResponseSchema.parse(result.data));
});

for (const [path, kind] of [
  ["likes", "like"],
  ["subscriptions", "subscription"],
] as const) {
  for (const [method, enabled] of [
    ["put", true],
    ["delete", false],
  ] as const) {
    meRoutes[method](`/${path}/:id`, async (c) => {
      const result = await c.executionCtx.exports.DataService.identityMe(sessionToken(c), {
        kind,
        projectId: c.req.param("id"),
        enabled,
      });
      if (!result.ok)
        return result.error === "unauthorized"
          ? jsonError(c, "unauthorized", "Login required")
          : jsonError(c, "not_found", "Project not found");
      return c.body(null, 204);
    });
  }
}

meRoutes.put("/ratings/:id", async (c) => {
  let body: unknown;
  let invalidJson = false;
  try {
    body = await c.req.json();
  } catch {
    invalidJson = true;
  }
  const parsed = ratingInputSchema.safeParse(body);
  const input = invalidJson ? "invalid_json" : parsed.success ? parsed.data : "invalid_rating";
  const result = await c.executionCtx.exports.DataService.identityMe(sessionToken(c), {
    kind: "rating",
    projectId: c.req.param("id"),
    input,
  });
  if (!result.ok) {
    if (result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (result.error === "invalid_json") return jsonError(c, "bad_request", "Invalid JSON body");
    if (result.error === "invalid_rating" && !parsed.success)
      return jsonError(c, "bad_request", "Invalid rating", parsed.error.flatten());
    return jsonError(c, "not_found", "Project not found");
  }
  return c.body(null, 204);
});

meRoutes.delete("/ratings/:id", async (c) => {
  const result = await c.executionCtx.exports.DataService.identityMe(sessionToken(c), {
    kind: "rating",
    projectId: c.req.param("id"),
    input: null,
  });
  if (!result.ok)
    return result.error === "unauthorized"
      ? jsonError(c, "unauthorized", "Login required")
      : jsonError(c, "not_found", "Project not found");
  return c.body(null, 204);
});
