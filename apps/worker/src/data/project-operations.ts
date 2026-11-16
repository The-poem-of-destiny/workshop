import type { ProjectPreviewKind } from "@workshop/contracts";
import { acquisitionResponseSchema, discoveryResponseSchema, downloadResponseSchema } from "@workshop/contracts";
import { deleteAdminRecommendation, updateAdminRecommendation } from "../storage/admin-recommendations.js";
import { getClientChannel } from "../storage/client.js";
import { getProjectEntryIndex, resolveProjectPreviewTarget } from "../storage/content-index.js";
import { recordAcquisition, releaseDownloads } from "../storage/downloads.js";
import { getDiscovery } from "../storage/home.js";
import { recordProjectChange } from "../storage/project-change-signals.js";
import { getPublishedProject, isValidProjectListCursor, listPublishedProjects } from "../storage/projects.js";
import { getReleaseAssets } from "../storage/releases.js";
import { getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env";

export async function projectList(env: DataEnv, query: Parameters<typeof listPublishedProjects>[1]) {
  if (!(await isValidProjectListCursor(query))) return { ok: false as const, error: "invalid_cursor" as const };
  return { ok: true as const, data: await listPublishedProjects(env.DB, query) };
}
export async function projectDiscovery(env: DataEnv) {
  return discoveryResponseSchema.parse(await getDiscovery(env.DB));
}
export function projectDetail(env: DataEnv, projectId: string) {
  return getPublishedProject(env.DB, projectId);
}
export function projectEntries(env: DataEnv, projectId: string) {
  return getProjectEntryIndex(env.DB, projectId);
}

export async function projectRecommendation(
  env: DataEnv,
  token: string,
  projectId: string,
  input: { projectVersionId: string; comment?: string },
  remove: boolean,
) {
  const session = await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET);
  if (!session) return { kind: "unauthorized" as const };
  return remove
    ? deleteAdminRecommendation(env.DB, projectId, session.userId, input.projectVersionId)
    : updateAdminRecommendation(env.DB, projectId, session.userId, input);
}

export async function projectChangeSignal(
  env: DataEnv,
  token: string,
  input: Parameters<typeof recordProjectChange>[2],
) {
  const session = await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET);
  if (!session) return { kind: "unauthorized" as const };
  return recordProjectChange(env.DB, session.userId, input);
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

export async function projectDownloads(env: DataEnv, token: string, projectId: string, acquisitionId: string) {
  const session = await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET);
  if (!session) return { ok: false as const, error: "unauthorized" as const };
  const release = await getReleaseAssets(env.DB, projectId, null, session);
  if (!release) return { ok: false as const, error: "not_found" as const };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(acquisitionId))
    return { ok: false as const, error: "bad_request" as const };
  const recorded = await recordAcquisition(env.DB, session, projectId, release.versionId, acquisitionId);
  if (recorded !== "ok") return { ok: false as const, error: recorded };
  return {
    ok: true as const,
    data: downloadResponseSchema.parse({
      versionId: release.versionId,
      files: releaseDownloads(projectId, release.versionId, release.files),
    }),
  };
}

export async function projectAcquisition(
  env: DataEnv,
  token: string,
  projectId: string,
  clientVersion: string | undefined,
  clientChannel: string | undefined,
  acquisitionId: string,
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
    SELECT p.id, r.title, r.project_type, r.included_types, p.updated_at, r.tags
    FROM projects p JOIN project_versions r ON r.id = p.published_version_id
    WHERE p.id = ? AND p.published_version_id = ?
  `)
    .bind(projectId, release.versionId)
    .first<{
      id: string;
      title: string;
      project_type: string;
      included_types: string;
      updated_at: string;
      tags: string;
    }>();
  if (!project) return { ok: false as const, error: "not_found" as const };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(acquisitionId))
    return { ok: false as const, error: "bad_request" as const };
  const recorded = await recordAcquisition(env.DB, session, projectId, release.versionId, acquisitionId);
  if (recorded !== "ok") return { ok: false as const, error: recorded };
  return {
    ok: true as const,
    data: acquisitionResponseSchema.parse({
      project: {
        id: project.id,
        title: project.title,
        projectType: project.project_type,
        includedTypes: JSON.parse(project.included_types) as unknown,
        version: release.versionId,
        manifestHash: release.manifestHash,
        updatedAt: project.updated_at,
        tags: JSON.parse(project.tags) as unknown,
      },
      release: {
        versionId: release.versionId,
        manifestHash: release.manifestHash,
        files: release.files.map(({ kind, sha256, bytes, mime }) => ({ kind, sha256, bytes, mime })),
      },
      downloads: releaseDownloads(projectId, release.versionId, release.files),
    }),
  };
}
