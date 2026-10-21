import { Hono } from "hono";
import { projectListQuerySchema, releaseManifestSchema } from "@workshop/contracts";
import { WORKSHOP_LIMITS } from "@workshop/domain";
import type { Env } from "../../env";
import { getClientChannel } from "../../storage/client.js";
import { getProjectEntryIndex } from "../../storage/content-index.js";
import { getDiscovery } from "../../storage/home.js";
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
    authorId: c.req.query("authorId"),
    tag: c.req.query("tag"),
    search: c.req.query("search"),
  });
  if (!parsed.success) {
    return jsonError(c, "bad_request", "Invalid query", parsed.error.flatten());
  }
  return c.json(await listPublishedProjects(c.env.DB, parsed.data));
});

projectsRoutes.get("/discovery", async c => c.json(await getDiscovery(c.env.DB)));

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
    session.sessionVersion,
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

projectsRoutes.get("/:id/entries", async c => {
  const index = await getProjectEntryIndex(c.env.DB, c.env.R2, c.req.param("id"));
  if (!index) return jsonError(c, "not_found", "Project not found");
  return c.json(index);
});

projectsRoutes.get("/:id/install", async c => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const projectId = c.req.param("id");
  const clientVersion = c.req.header("x-client-version");
  if (clientVersion) {
    const current = await getClientChannel(c.env.DB, c.req.header("x-client-channel") ?? "stable");
    if (current && current.version !== clientVersion) {
      return jsonError(c, "upgrade_required", "Client version does not match the current channel", {
        required: current.version,
        received: clientVersion,
      });
    }
  }
  const release = await getReleaseAssets(c.env.DB, projectId, null, session);
  if (!release) return jsonError(c, "not_found", "Release not found");
  const project = await c.env.DB.prepare(`
    SELECT p.id, p.title, p.project_type, p.extension_type, p.updated_at,
           r.title AS revision_title, r.tags
    FROM projects p JOIN project_revisions r ON r.id = p.published_revision_id
    WHERE p.id = ? AND p.published_revision_id = ?
  `).bind(projectId, release.revisionId).first<{
    id: string; title: string; project_type: string | null; extension_type: string | null;
    updated_at: string; revision_title: string; tags: string;
  }>();
  if (!project) return jsonError(c, "not_found", "Release not found");

  const files: Record<string, string> = {};
  for (const file of release.files) {
    const object = await c.env.R2.get(file.r2Key);
    if (!object) return jsonError(c, "not_found", `Missing ${file.kind} file`);
    files[file.kind] = await object.text();
  }
  await recordDownload(c.env.DB, projectId, session.userId).catch(() => undefined);
  return c.json({
    project: {
      id: project.id,
      title: project.revision_title || project.title,
      projectType: project.project_type,
      extensionType: project.extension_type,
      version: release.revisionId,
      manifestHash: release.manifestHash,
      updatedAt: project.updated_at,
      tags: JSON.parse(project.tags) as unknown,
    },
    files,
  });
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
