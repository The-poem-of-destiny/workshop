import { inspectProjectMetadata } from "@workshop/domain";
import { fetchImmutableObject } from "../data-client.js";
import {
  getAdminSubmission,
  getSubmissionAsset,
  listAdminSubmissions,
  reviewAdminSubmission,
} from "../storage/admin.js";
import {
  changeAdminMemberRole,
  listAdminAuditEvents,
  listAdminMembers,
  listAdminProjects,
} from "../storage/admin-directory.js";
import { deleteAdminRecommendation, updateAdminRecommendation } from "../storage/admin-recommendations.js";
import {
  createAdminReferenceSet,
  createAdminReferenceVersion,
  updateAdminReferenceSet,
} from "../storage/admin-references.js";
import { createProject, getProjectSummary, softDeleteProject, updateVisibility } from "../storage/authoring.js";
import { deleteProjectEntry } from "../storage/authoring-assets.js";
import { getAuthoringProject } from "../storage/authoring-model.js";
import { createRevision, patchProject } from "../storage/authoring-revisions.js";
import { submitRevision, withdrawSubmission } from "../storage/authoring-submissions.js";
import { getSubmissionDiff } from "../storage/diff.js";
import { deleteGalleryImage, getAuthorGallery } from "../storage/project-gallery.js";
import { getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env.js";

async function reviewer(env: DataEnv, authorization: string | undefined, owner = false) {
  const session = authorization?.startsWith("Bearer ")
    ? await getSessionByToken(env.DB, authorization.slice(7), env.SESSION_HASH_SECRET)
    : null;
  if (!session) return { kind: "unauthorized" as const };
  if (owner ? session.role !== "owner" : session.role !== "reviewer" && session.role !== "owner") {
    return { kind: "forbidden" as const };
  }
  return { kind: "ok" as const, session };
}

export async function authorAdminListProjects(
  env: DataEnv,
  authorization: string | undefined,
  limit: number,
  cursor: string | undefined,
  filters: { search?: string; projectType?: string; includeDeleted?: boolean },
) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await listAdminProjects(env.DB, limit, cursor, filters) };
}

export async function authorAdminListMembers(
  env: DataEnv,
  authorization: string | undefined,
  limit: number,
  cursor: string | undefined,
) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await listAdminMembers(env.DB, limit, cursor) };
}

export async function authorAdminListAuditEvents(
  env: DataEnv,
  authorization: string | undefined,
  limit: number,
  cursor: string | undefined,
  action: string | undefined,
) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await listAdminAuditEvents(env.DB, limit, cursor, action) };
}

export async function authorAdminChangeMemberRole(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
  role: "member" | "reviewer" | "owner",
) {
  const auth = await reviewer(env, authorization, true);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await changeAdminMemberRole(env.DB, id, role, auth.session.userId) };
}

export async function authorAdminListSubmissions(
  env: DataEnv,
  authorization: string | undefined,
  query: Parameters<typeof listAdminSubmissions>[1],
) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await listAdminSubmissions(env.DB, query) };
}

export async function authorAdminGetSubmission(env: DataEnv, authorization: string | undefined, id: string) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await getAdminSubmission(env.DB, id) };
}

export async function authorAdminGetDiff(env: DataEnv, authorization: string | undefined, id: string) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await getSubmissionDiff(env.DB, env.R2, id) };
}

export async function authorAdminReview(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
  request: Parameters<typeof reviewAdminSubmission>[3],
) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await reviewAdminSubmission(env.DB, id, auth.session.userId, request) };
}

export async function authorAdminUpdateRecommendation(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
  update: Parameters<typeof updateAdminRecommendation>[3],
) {
  const auth = await reviewer(env, authorization, true);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await updateAdminRecommendation(env.DB, id, auth.session.userId, update) };
}

export async function authorAdminDeleteRecommendation(env: DataEnv, authorization: string | undefined, id: string) {
  const auth = await reviewer(env, authorization, true);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await deleteAdminRecommendation(env.DB, id, auth.session.userId) };
}

export async function authorAdminCreateReferenceSet(
  env: DataEnv,
  authorization: string | undefined,
  input: Parameters<typeof createAdminReferenceSet>[2],
) {
  const auth = await reviewer(env, authorization, true);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await createAdminReferenceSet(env.DB, auth.session.userId, input) };
}

export async function authorAdminCreateReferenceVersion(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
  input: Parameters<typeof createAdminReferenceVersion>[3],
) {
  const auth = await reviewer(env, authorization, true);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await createAdminReferenceVersion(env.DB, auth.session.userId, id, input) };
}

export async function authorAdminUpdateReferenceSet(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
  input: Parameters<typeof updateAdminReferenceSet>[3],
) {
  const auth = await reviewer(env, authorization, true);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await updateAdminReferenceSet(env.DB, id, auth.session.userId, input) };
}

export async function authorAdminRecheck(env: DataEnv, authorization: string | undefined, id: string) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  const now = new Date().toISOString();
  const [audit] = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      SELECT ?, 'checker.recheck', 'submission', id, ?,
        json_object('reason', 'explicit reviewer recheck', 'previousRevision', review_checker_revision), ?
      FROM submissions
      WHERE id = ? AND status IN ('pending', 'checking') AND check_status NOT IN ('queued', 'running')
    `).bind(crypto.randomUUID(), auth.session.userId, now, id),
    env.DB.prepare(`
      UPDATE submissions
      SET status = 'pending', check_status = 'queued', check_attempts = 0,
          check_lease_until = NULL, check_error = NULL, review_checker_revision = NULL
      WHERE id = ? AND changes() = 1
    `).bind(id),
  ]);
  if ((audit?.meta.changes ?? 0) !== 0) return { kind: "ok" as const };

  const target = await env.DB.prepare("SELECT status FROM submissions WHERE id = ?")
    .bind(id)
    .first<{ status: string }>();
  if (!target) return { kind: "not_found" as const };
  if (target.status !== "pending" && target.status !== "checking") return { kind: "resolved" as const };
  return { kind: "running" as const };
}

export async function authorAdminFetch(request: Request, env: DataEnv, context: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/api\/v1\/admin\/submissions\/([^/]+)\/files\/(worldbook|regex|cover)$/.exec(url.pathname);
  if (request.method !== "GET" || !match) return new Response(null, { status: 404 });
  const auth = await reviewer(env, request.headers.get("authorization") ?? undefined);
  if (auth.kind !== "ok") {
    const status = auth.kind === "unauthorized" ? 401 : 403;
    return Response.json({ error: { code: auth.kind, message: "Reviewer access required" } }, { status });
  }
  const kind = match[2] as "worldbook" | "regex" | "cover";
  const asset = await getSubmissionAsset(env.DB, decodeURIComponent(match[1]!), kind);
  if (!asset) return Response.json({ error: { code: "not_found", message: "File not found" } }, { status: 404 });
  const cacheable =
    /^[a-f0-9]{64}$/.test(asset.sha256) && asset.r2_key.split("/").pop()?.includes(`-${asset.sha256}.`) === true;
  let body: ReadableStream<Uint8Array>;
  if (cacheable) {
    const object = await fetchImmutableObject(context, {
      r2Key: asset.r2_key,
      sha256: asset.sha256,
      identity: asset.r2_key,
    });
    if (object.status === 404) {
      await object.body?.cancel();
      return Response.json({ error: { code: "not_found", message: "File not found" } }, { status: 404 });
    }
    if (!object.ok || !object.body) {
      await object.body?.cancel();
      throw new Error("Failed to read submission file");
    }
    body = object.body;
  } else {
    const object = await env.R2.get(asset.r2_key);
    if (!object) return Response.json({ error: { code: "not_found", message: "File not found" } }, { status: 404 });
    body = object.body;
  }
  return new Response(body, {
    headers: {
      "content-type": asset.mime,
      "content-length": String(asset.bytes),
      "cache-control": "private, no-store",
    },
  });
}

async function author(env: DataEnv, authorization: string | undefined) {
  return authorization?.startsWith("Bearer ")
    ? getSessionByToken(env.DB, authorization.slice(7), env.SESSION_HASH_SECRET)
    : null;
}

export async function authorAdminCreateProject(
  env: DataEnv,
  authorization: string | undefined,
  input: Parameters<typeof createProject>[2],
) {
  const session = await author(env, authorization);
  if (!session) return { kind: "unauthorized" as const };
  return { kind: "ok" as const, data: await createProject(env.DB, session, input) };
}

export async function authorAdminGetDraft(env: DataEnv, authorization: string | undefined, id: string) {
  const session = await author(env, authorization);
  if (!session) return { kind: "unauthorized" as const };
  const project = await getAuthoringProject(env.DB, id, session);
  if (!project) return { kind: "not_found" as const };
  const summary = await getProjectSummary(env.DB, project.id);
  if (!summary) return { kind: "not_found" as const };
  const latestSubmission = await env.DB.prepare(`
    SELECT s.id, s.revision_id, s.status, s.check_status, s.resolved_at, r.decision, r.reason
    FROM submissions s LEFT JOIN reviews r ON r.submission_id = s.id
    WHERE s.project_id = ? ORDER BY s.submitted_at DESC LIMIT 1
  `)
    .bind(project.id)
    .first<{
      id: string;
      revision_id: string;
      status: string;
      check_status: string;
      resolved_at: string | null;
      decision: string | null;
      reason: string | null;
    }>();
  return {
    kind: "ok" as const,
    data: {
      project: summary,
      rowVersion: project.row_version,
      workingRevisionId: project.working_revision_id,
      latestSubmission: latestSubmission ?? null,
    },
  };
}

export async function authorAdminDeleteEntry(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  revisionId: string,
  kind: "worldbook" | "regex",
  entryKey: string,
  expectedVersion: number,
) {
  const session = await author(env, authorization);
  if (!session) return { kind: "unauthorized" as const };
  return {
    kind: "ok" as const,
    data: await deleteProjectEntry(env.DB, env.R2, session, projectId, revisionId, kind, entryKey, expectedVersion),
  };
}

export async function authorAdminGetGallery(env: DataEnv, authorization: string | undefined, projectId: string) {
  const session = await author(env, authorization);
  if (!session) return { kind: "unauthorized" as const };
  return { kind: "ok" as const, data: await getAuthorGallery(env.DB, projectId, session) };
}

export async function authorAdminDeleteGallery(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  slot: number,
  expectedVersion: number | null,
) {
  const session = await author(env, authorization);
  if (!session) return { kind: "unauthorized" as const };
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return { kind: "not_found" as const };
  if (expectedVersion === null) return { kind: "version_conflict" as const, actual: project.row_version };
  const result = await deleteGalleryImage(env.DB, session, project.id, slot, expectedVersion);
  if (result.kind === "conflict") {
    const latest = await getAuthoringProject(env.DB, project.id, session);
    return { kind: "version_conflict" as const, actual: latest?.row_version ?? project.row_version };
  }
  return { kind: "ok" as const, data: result };
}

export async function authorAdminDeleteProject(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  expectedVersion: number | null,
) {
  const session = await author(env, authorization);
  if (!session) return { kind: "unauthorized" as const };
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return { kind: "not_found" as const };
  if (expectedVersion === null || expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  if (!(await softDeleteProject(env.DB, session, project.id, expectedVersion)))
    return { kind: "version_conflict" as const, actual: project.row_version };
  return { kind: "ok" as const };
}

export async function authorAdminUpdateVisibility(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  expectedVersion: number | null,
  input: Parameters<typeof updateVisibility>[4],
) {
  const session = await author(env, authorization);
  if (!session) return { kind: "unauthorized" as const };
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return { kind: "not_found" as const };
  if (expectedVersion === null || expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  const rowVersion = await updateVisibility(env.DB, session, project.id, expectedVersion, input);
  if (!rowVersion) return { kind: "version_conflict" as const, actual: project.row_version };
  return { kind: "ok" as const, rowVersion };
}

async function authorAdminEditMetadata(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  expectedVersion: number | null,
  input: Parameters<typeof patchProject>[4],
  revision: boolean,
) {
  const session = await author(env, authorization);
  if (!session) return { kind: "unauthorized" as const };
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return { kind: "not_found" as const };
  if (expectedVersion === null || expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  if (!revision && project.working_revision_frozen) return { kind: "frozen" as const };
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const count = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM audit_events WHERE target_id = ? AND actor_id = ?
        AND action IN ('project.patch', 'project.published_metadata.patch', 'project.published_cover.put') AND created_at > ?)
      + (SELECT COUNT(*) FROM project_revisions WHERE project_id = ? AND created_by = ? AND created_at > ?) AS total
  `)
    .bind(project.id, session.userId, cutoff, project.id, session.userId, cutoff)
    .first<{ total: number }>();
  if ((count?.total ?? 0) >= 20) return { kind: "rate_limited" as const };
  const metadata = inspectProjectMetadata({
    title: input.title ?? project.title,
    description: input.description !== undefined ? input.description : project.description,
    authorNote: input.authorNote !== undefined ? input.authorNote : project.author_note,
    precautions: input.precautions !== undefined ? input.precautions : project.precautions,
    versionLabel: input.versionLabel !== undefined ? input.versionLabel : project.version_label,
    tags: input.tags,
    coverPositionX: input.coverPositionX ?? project.cover_position_x,
    coverPositionY: input.coverPositionY ?? project.cover_position_y,
    coverZoom: input.coverZoom ?? project.cover_zoom,
  });
  if (metadata.gate === "block") return { kind: "invalid_metadata" as const, findings: metadata.findings };
  const result = revision
    ? await createRevision(env.DB, session, project.id, expectedVersion, input)
    : await patchProject(env.DB, session, project.id, expectedVersion, input);
  if (!result) return { kind: "cas_conflict" as const, actual: project.row_version };
  return { kind: "ok" as const, data: result };
}

export function authorAdminPatchProject(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  expectedVersion: number | null,
  input: Parameters<typeof patchProject>[4],
) {
  return authorAdminEditMetadata(env, authorization, projectId, expectedVersion, input, false);
}

export function authorAdminCreateRevision(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  expectedVersion: number | null,
  input: Parameters<typeof patchProject>[4],
) {
  return authorAdminEditMetadata(env, authorization, projectId, expectedVersion, input, true);
}

export async function authorAdminSubmit(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  revisionId: string,
  expectedVersion: number,
  input: Parameters<typeof submitRevision>[6],
  prevalidated: Parameters<typeof submitRevision>[7],
) {
  const session = await author(env, authorization);
  if (!session) return { kind: "unauthorized" as const };
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return { kind: "not_found" as const, message: "Project not found" };
  if (expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  if (project.working_revision_id !== revisionId)
    return { kind: "not_found" as const, message: "Working revision not found" };
  if (project.working_revision_frozen)
    return { kind: "conflict" as const, message: "Revision is already submitted; create a new revision" };
  const result = await submitRevision(
    env.DB,
    session,
    project.id,
    revisionId,
    expectedVersion,
    project.published_revision_id,
    input,
    prevalidated,
  );
  if (!result.ok) {
    if (result.code === "conflict") {
      const latest = await getAuthoringProject(env.DB, project.id, session);
      if (latest && latest.row_version !== expectedVersion)
        return { kind: "version_conflict" as const, actual: latest.row_version };
    }
    return { kind: "error" as const, code: result.code, message: result.message };
  }
  return { kind: "ok" as const, data: result };
}

export async function authorAdminWithdraw(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  submissionId: string,
  expectedVersion: number,
) {
  const session = await author(env, authorization);
  if (!session) return { kind: "unauthorized" as const };
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return { kind: "not_found" as const };
  if (expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  const result = await withdrawSubmission(env.DB, session, project.id, submissionId, expectedVersion);
  return { kind: "ok" as const, data: result };
}

export async function authorAdminPrepareSubmission(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  revisionId: string,
  expectedVersion: number,
) {
  const session = await author(env, authorization);
  if (!session) return { kind: "unauthorized" as const };
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return { kind: "not_found" as const, message: "Project not found" };
  if (expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  if (project.working_revision_id !== revisionId)
    return { kind: "not_found" as const, message: "Working revision not found" };
  if (project.working_revision_frozen)
    return { kind: "conflict" as const, message: "Revision is already submitted; create a new revision" };
  return { kind: "ok" as const };
}
