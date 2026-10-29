import type { ProjectPreviewKind } from "@workshop/contracts";
import { acquisitionResponseSchema, discoveryResponseSchema, downloadTicketResponseSchema } from "@workshop/contracts";
import { WORKSHOP_LIMITS } from "@workshop/domain";
import { getClientChannel } from "../storage/client.js";
import { getProjectEntryIndex, resolveProjectPreviewTarget } from "../storage/content-index.js";
import { issueDownloadTickets } from "../storage/downloads.js";
import { getDiscovery } from "../storage/home.js";
import { getPublishedProject, isValidProjectListCursor, listPublishedProjects } from "../storage/projects.js";
import { getRankings } from "../storage/rankings.js";
import { getReleaseAssets } from "../storage/releases.js";
import { getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env";

export async function projectList(env: DataEnv, query: Parameters<typeof listPublishedProjects>[1]) {
  if (!isValidProjectListCursor(query)) return { ok: false as const, error: "invalid_cursor" as const };
  return { ok: true as const, data: await listPublishedProjects(env.DB, query) };
}
export async function projectDiscovery(env: DataEnv) {
  return discoveryResponseSchema.parse(await getDiscovery(env.DB));
}
export function projectRankings(env: DataEnv, kind: Parameters<typeof getRankings>[1]) {
  return getRankings(env.DB, kind);
}
export function projectDetail(env: DataEnv, projectId: string) {
  return getPublishedProject(env.DB, projectId);
}
export function projectEntries(env: DataEnv, projectId: string) {
  return getProjectEntryIndex(env.DB, projectId);
}

export async function projectPreviewTarget(
  env: DataEnv,
  token: string,
  projectId: string,
  kind: ProjectPreviewKind | null,
) {
  const session = await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET);
  if (!session) return { ok: false as const, error: "unauthorized" as const };
  if (!kind) return { ok: false as const, error: "invalid_kind" as const };
  const target = await resolveProjectPreviewTarget(env.DB, projectId, kind);
  return target ? { ok: true as const, target } : { ok: false as const, error: "not_found" as const };
}

export async function projectTickets(env: DataEnv, token: string, projectId: string) {
  const session = await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET);
  if (!session) return { ok: false as const, error: "unauthorized" as const };
  const release = await getReleaseAssets(env.DB, projectId, null, session);
  if (!release) return { ok: false as const, error: "not_found" as const };
  const tickets = await issueDownloadTickets(
    env.DB,
    projectId,
    release.revisionId,
    session.userId,
    session.sessionVersion,
    release.files,
    WORKSHOP_LIMITS.downloadTicketTtlMs,
  );
  return {
    ok: true as const,
    data: downloadTicketResponseSchema.parse({
      revisionId: release.revisionId,
      files: tickets.map((ticket) => ({
        kind: ticket.kind,
        url: `/api/v1/downloads/${ticket.token}`,
        expiresAt: ticket.expiresAt,
      })),
    }),
  };
}

export async function projectAcquisition(
  env: DataEnv,
  token: string,
  projectId: string,
  clientVersion: string | undefined,
  clientChannel: string | undefined,
) {
  const session = await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET);
  if (!session) return { ok: false as const, error: "unauthorized" as const };
  if (!clientVersion || (clientChannel !== "stable" && clientChannel !== "staging")) {
    return {
      ok: false as const,
      error: "upgrade_required" as const,
      message: "Client version and channel are required",
      details: { required: null, received: clientVersion ?? null },
    };
  }
  const current = await getClientChannel(env.DB, clientChannel);
  if (!current || current.version !== clientVersion) {
    return {
      ok: false as const,
      error: "upgrade_required" as const,
      message: "Client version does not match the current channel",
      details: { required: current?.version ?? null, received: clientVersion },
    };
  }
  const release = await getReleaseAssets(env.DB, projectId, null, session);
  if (!release) return { ok: false as const, error: "not_found" as const };
  const project = await env.DB.prepare(`
    SELECT p.id, p.title, p.project_type, p.extension_type, p.updated_at, p.search_tags AS tags
    FROM projects p WHERE p.id = ? AND p.published_revision_id = ?
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
  if (!project) return { ok: false as const, error: "not_found" as const };
  const tickets = await issueDownloadTickets(
    env.DB,
    projectId,
    release.revisionId,
    session.userId,
    session.sessionVersion,
    release.files,
    WORKSHOP_LIMITS.downloadTicketTtlMs,
  );
  return {
    ok: true as const,
    data: acquisitionResponseSchema.parse({
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
  };
}
