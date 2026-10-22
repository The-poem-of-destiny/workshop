import {
  acquisitionResponseSchema,
  discoveryResponseSchema,
  downloadTicketResponseSchema,
  projectListQuerySchema,
} from "@workshop/contracts";
import { WORKSHOP_LIMITS } from "@workshop/domain";
import { Hono } from "hono";
import type { Env } from "../../env";
import { getClientChannel } from "../../storage/client.js";
import { getProjectEntryIndex } from "../../storage/content-index.js";
import { issueDownloadTickets } from "../../storage/downloads.js";
import { getDiscovery } from "../../storage/home.js";
import { getPublishedProject, isValidProjectListCursor, listPublishedProjects } from "../../storage/projects.js";
import { getRankings } from "../../storage/rankings.js";
import { getReleaseAssets } from "../../storage/releases.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";

export const projectsRoutes = new Hono<{ Bindings: Env }>();

projectsRoutes.get("/", async (c) => {
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
  if (!isValidProjectListCursor(parsed.data.cursor, parsed.data.sort)) {
    return jsonError(c, "bad_request", "Invalid cursor");
  }
  return c.json(await listPublishedProjects(c.env.DB, parsed.data));
});

projectsRoutes.get("/discovery", async (c) => c.json(discoveryResponseSchema.parse(await getDiscovery(c.env.DB))));

projectsRoutes.get("/rankings", async (c) => {
  const kind = c.req.query("kind") ?? "7d";
  if (kind !== "daily" && kind !== "7d" && kind !== "30d") {
    return jsonError(c, "bad_request", "Unknown ranking kind");
  }
  return c.json(await getRankings(c.env.DB, kind));
});

projectsRoutes.get("/:id", async (c) => {
  const project = await getPublishedProject(c.env.DB, c.req.param("id"));
  if (!project) return jsonError(c, "not_found", "Project not found");
  return c.json(project);
});

projectsRoutes.post("/:id/downloads", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const projectId = c.req.param("id");
  const release = await getReleaseAssets(c.env.DB, projectId, null, session);
  if (!release) return jsonError(c, "not_found", "Release not found");

  const tickets = await issueDownloadTickets(
    c.env.DB,
    projectId,
    release.revisionId,
    session.userId,
    session.sessionVersion,
    release.files,
    WORKSHOP_LIMITS.downloadTicketTtlMs,
  );
  return c.json(
    downloadTicketResponseSchema.parse({
      revisionId: release.revisionId,
      files: tickets.map((ticket) => ({
        kind: ticket.kind,
        url: `/api/v1/downloads/${ticket.token}`,
        expiresAt: ticket.expiresAt,
      })),
    }),
    201,
  );
});

projectsRoutes.get("/:id/entries", async (c) => {
  const index = await getProjectEntryIndex(c.env.DB, c.req.param("id"));
  if (!index) return jsonError(c, "not_found", "Project not found");
  return c.json(index);
});

projectsRoutes.post("/:id/acquisitions", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const projectId = c.req.param("id");
  const clientVersion = c.req.header("x-client-version")?.trim();
  const clientChannel = c.req.header("x-client-channel")?.trim();
  if (!clientVersion || (clientChannel !== "stable" && clientChannel !== "staging")) {
    return jsonError(c, "upgrade_required", "Client version and channel are required", {
      required: null,
      received: clientVersion ?? null,
    });
  }
  const current = await getClientChannel(c.env.DB, clientChannel);
  if (!current || current.version !== clientVersion) {
    return jsonError(c, "upgrade_required", "Client version does not match the current channel", {
      required: current?.version ?? null,
      received: clientVersion,
    });
  }
  const release = await getReleaseAssets(c.env.DB, projectId, null, session);
  if (!release) return jsonError(c, "not_found", "Release not found");
  const project = await c.env.DB.prepare(`
    SELECT p.id, p.title, p.project_type, p.extension_type, p.updated_at, p.search_tags AS tags
    FROM projects p
    WHERE p.id = ? AND p.published_revision_id = ?
  `)
    .bind(projectId, release.revisionId)
    .first<{
      id: string;
      title: string;
      project_type: string | null;
      extension_type: string | null;
      updated_at: string;
      tags: string;
    }>();
  if (!project) return jsonError(c, "not_found", "Release not found");

  const tickets = await issueDownloadTickets(
    c.env.DB,
    projectId,
    release.revisionId,
    session.userId,
    session.sessionVersion,
    release.files,
    WORKSHOP_LIMITS.downloadTicketTtlMs,
  );
  return c.json(
    acquisitionResponseSchema.parse({
      project: {
        id: project.id,
        title: project.title,
        projectType: project.project_type,
        extensionType: project.extension_type,
        version: release.revisionId,
        manifestHash: release.manifestHash,
        updatedAt: project.updated_at,
        tags: JSON.parse(project.tags) as unknown,
      },
      release: {
        revisionId: release.revisionId,
        manifestHash: release.manifestHash,
        files: release.files.map(({ kind, sha256, bytes, mime }) => ({ kind, sha256, bytes, mime })),
      },
      tickets: tickets.map((ticket) => ({
        kind: ticket.kind,
        url: `/api/v1/downloads/${ticket.token}`,
        expiresAt: ticket.expiresAt,
      })),
    }),
    201,
  );
});
