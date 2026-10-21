import { Hono } from "hono";
import { projectListQuerySchema, releaseManifestSchema } from "@workshop/contracts";
import { WORKSHOP_LIMITS } from "@workshop/domain";
import type { Env } from "../../env";
import { issueDownloadTickets, recordDownload } from "../../storage/downloads.js";
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

projectsRoutes.post("/:id/downloads", async c => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const projectId = c.req.param("id");
  const release = await getReleaseAssets(c.env.DB, projectId, null, session);
  if (!release) return jsonError(c, "not_found", "Release not found");

  const recorded = await recordDownload(c.env.DB, projectId, session.userId);
  if (recorded === "not_found") return jsonError(c, "not_found", "Project not found");

  const tickets = await issueDownloadTickets(
    c.env.DB,
    projectId,
    release.revisionId,
    session.userId,
    release.files,
    WORKSHOP_LIMITS.downloadTicketTtlMs,
  );
  return c.json({
    revisionId: release.revisionId,
    files: tickets.map(ticket => ({
      kind: ticket.kind,
      url: `/api/v1/downloads/${ticket.token}`,
      expiresAt: ticket.expiresAt,
    })),
  }, 201);
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
