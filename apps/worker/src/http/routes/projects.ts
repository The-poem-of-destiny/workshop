import { projectListQuerySchema, projectPreviewKindSchema, projectPreviewSchema } from "@workshop/contracts";
import { Hono } from "hono";
import { fetchProjectPreview } from "../../data-client.js";
import type { Env } from "../../env";
import { jsonError } from "../errors.js";
import { sessionToken } from "../session.js";

export const projectsRoutes = new Hono<{ Bindings: Env }>();

projectsRoutes.get("/", async (c) => {
  const parsed = projectListQuerySchema.safeParse({
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
    sort: c.req.query("sort"),
    period: c.req.query("period"),
    projectType: c.req.query("projectType"),
    authorId: c.req.query("authorId"),
    tag: c.req.query("tag"),
    search: c.req.query("search"),
  });
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid query", parsed.error.flatten());
  const result = await c.executionCtx.exports.DataService.projectList(parsed.data);
  if (!result.ok) return jsonError(c, "bad_request", "Invalid cursor");
  return c.json(result.data);
});

projectsRoutes.get("/discovery", async (c) => c.json(await c.executionCtx.exports.DataService.projectDiscovery()));

projectsRoutes.get("/rankings", async (c) => {
  const kind = c.req.query("kind") ?? "7d";
  if (kind !== "daily" && kind !== "7d" && kind !== "30d") return jsonError(c, "bad_request", "Unknown ranking kind");
  return c.json(await c.executionCtx.exports.DataService.projectRankings(kind));
});

projectsRoutes.get("/:id", async (c) => {
  const project = await c.executionCtx.exports.DataService.projectDetail(c.req.param("id"));
  if (!project) return jsonError(c, "not_found", "Project not found");
  return c.json(project);
});

projectsRoutes.post("/:id/downloads", async (c) => {
  const result = await c.executionCtx.exports.DataService.projectTickets(sessionToken(c), c.req.param("id"));
  if (!result.ok)
    return result.error === "unauthorized"
      ? jsonError(c, "unauthorized", "Login required")
      : jsonError(c, "not_found", "Release not found");
  return c.json(result.data, 201);
});

projectsRoutes.get("/:id/entries", async (c) => {
  const index = await c.executionCtx.exports.DataService.projectEntries(c.req.param("id"));
  if (!index) return jsonError(c, "not_found", "Project not found");
  return c.json(index);
});

projectsRoutes.get("/:id/preview/:kind", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const kind = projectPreviewKindSchema.safeParse(c.req.param("kind"));
  // Authentication takes precedence over kind validation, as in the original route.
  const result = await c.executionCtx.exports.DataService.projectPreviewTarget(
    sessionToken(c),
    c.req.param("id"),
    kind.success ? kind.data : null,
  );
  if (!result.ok && result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (!kind.success) return jsonError(c, "bad_request", "Unknown preview kind");
  if (!result.ok) return jsonError(c, "not_found", "Project preview not found");
  if (!result.target.r2Key)
    return c.json(
      projectPreviewSchema.parse({ revisionId: result.target.revisionId, kind: result.target.kind, entries: [] }),
    );
  const response = await fetchProjectPreview(c.executionCtx, result.target);
  if (response.status === 404) return jsonError(c, "not_found", "Project preview not found");
  if (!response.ok) return jsonError(c, "internal", "Project preview unavailable");
  return c.json(projectPreviewSchema.parse(await response.json()));
});

projectsRoutes.post("/:id/acquisitions", async (c) => {
  const result = await c.executionCtx.exports.DataService.projectAcquisition(
    sessionToken(c),
    c.req.param("id"),
    c.req.header("x-client-version")?.trim(),
    c.req.header("x-client-channel")?.trim(),
  );
  if (!result.ok) {
    if (result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (result.error === "upgrade_required") return jsonError(c, "upgrade_required", result.message, result.details);
    return jsonError(c, "not_found", "Release not found");
  }
  return c.json(result.data, 201);
});
