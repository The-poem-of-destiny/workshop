import { Hono } from "hono";
import { projectListQuerySchema, releaseManifestSchema } from "@workshop/contracts";
import type { Env } from "../../env";
import { getPublishedProject, listPublishedProjects } from "../../storage/projects.js";
import { getReleaseAssets } from "../../storage/releases.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";

export const projectsRoutes = new Hono<{ Bindings: Env }>();

projectsRoutes.get("/", async c => {
  const parsed = projectListQuerySchema.safeParse({
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
    sort: c.req.query("sort"),
    projectType: c.req.query("projectType"),
    search: c.req.query("search"),
  });
  if (!parsed.success) {
    return jsonError(c, "bad_request", "Invalid query", parsed.error.flatten());
  }
  return c.json(await listPublishedProjects(c.env.DB, parsed.data));
});

projectsRoutes.get("/:id", async c => {
  const project = await getPublishedProject(c.env.DB, c.req.param("id"));
  if (!project) return jsonError(c, "not_found", "Project not found");
  return c.json(project);
});

projectsRoutes.get("/:id/releases/:releaseId/manifest", async c => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const release = await getReleaseAssets(c.env.DB, c.req.param("id"), c.req.param("releaseId"), session);
  if (!release) return jsonError(c, "not_found", "Release not found");
  return c.json(releaseManifestSchema.parse({
    revisionId: release.revisionId,
    manifestHash: release.manifestHash,
    files: release.files.map(({ kind, sha256, bytes, mime }) => ({ kind, sha256, bytes, mime })),
  }));
});

projectsRoutes.get("/:id/releases/:releaseId/files/:kind", async c => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const kind = c.req.param("kind");
  if (kind !== "worldbook" && kind !== "regex") {
    return jsonError(c, "bad_request", "Unsupported file kind");
  }
  const release = await getReleaseAssets(c.env.DB, c.req.param("id"), c.req.param("releaseId"), session);
  const asset = release?.files.find(file => file.kind === kind);
  if (!asset) return jsonError(c, "not_found", "File not found");
  const object = await c.env.R2.get(asset.r2Key);
  if (!object) return jsonError(c, "not_found", "File not found");
  return new Response(object.body, {
    headers: {
      "content-type": asset.mime,
      "content-length": String(asset.bytes),
      "cache-control": "private, no-store",
    },
  });
});
