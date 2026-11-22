import type { AuditAction, ProjectType } from "@workshop/contracts";
import {
  getAdminSubmission,
  getSubmissionAsset,
  listAdminSubmissions,
  requeueAdminSubmission,
  reviewAdminSubmission,
} from "../storage/admin.js";
import {
  changeAdminMemberRole,
  listAdminAuditEvents,
  listAdminMembers,
  listAdminProjects,
} from "../storage/admin-directory.js";
import { deleteAdminRecommendation, updateAdminRecommendation } from "../storage/admin-recommendations.js";
import { getSubmissionDiff } from "../storage/diff.js";
import { getSessionByToken } from "../storage/sessions.js";
import { refreshPublicProjectImages } from "./authoring-operations.js";
import type { DataEnv } from "./env.js";
import { fetchImmutableObject } from "./object-cache.js";
import { withdrawPublicCover } from "./public-covers.js";

async function reviewer(env: DataEnv, authorization: string | undefined, owner = false) {
  const session = authorization?.startsWith("Bearer ")
    ? await getSessionByToken(env.DB, authorization.slice(7), env.SESSION_HASH_SECRET)
    : null;
  if (!session) return { kind: "unauthorized" as const };
  if (!session.policyAccepted) return { kind: "forbidden" as const };
  if (owner ? session.role !== "owner" : session.role !== "reviewer" && session.role !== "owner") {
    return { kind: "forbidden" as const };
  }
  return { kind: "ok" as const, session };
}

export async function adminListProjects(
  env: DataEnv,
  authorization: string | undefined,
  limit: number,
  cursor: string | undefined,
  filters: { search?: string; projectType?: ProjectType; includeDeleted?: boolean },
) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await listAdminProjects(env.DB, limit, cursor, filters) };
}

export async function adminListMembers(
  env: DataEnv,
  authorization: string | undefined,
  limit: number,
  cursor: string | undefined,
) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await listAdminMembers(env.DB, limit, cursor) };
}

export async function adminListAuditEvents(
  env: DataEnv,
  authorization: string | undefined,
  limit: number,
  cursor: string | undefined,
  action: AuditAction | undefined,
) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await listAdminAuditEvents(env.DB, limit, cursor, action) };
}

export async function adminChangeMemberRole(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
  role: "member" | "reviewer" | "owner",
) {
  const auth = await reviewer(env, authorization, true);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await changeAdminMemberRole(env.DB, id, role, auth.session.userId) };
}

export async function adminListSubmissions(
  env: DataEnv,
  authorization: string | undefined,
  query: Parameters<typeof listAdminSubmissions>[1],
) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await listAdminSubmissions(env.DB, query) };
}

export async function adminGetSubmission(env: DataEnv, authorization: string | undefined, id: string) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await getAdminSubmission(env.DB, env.R2, id) };
}

export async function adminGetDiff(env: DataEnv, authorization: string | undefined, id: string) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await getSubmissionDiff(env.DB, env.R2, id) };
}

export async function adminReview(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
  request: Parameters<typeof reviewAdminSubmission>[3],
) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  const target =
    env.PUBLIC_COVERS && request.decision === "approve"
      ? await env.DB.prepare("SELECT project_id FROM submissions WHERE id = ? AND status = 'pending'")
          .bind(id)
          .first<{ project_id: string }>()
      : null;
  if (target && !(await withdrawPublicCover(env, target.project_id)))
    throw new Error("Public cover withdrawal pending");
  const data = await reviewAdminSubmission(env.DB, id, auth.session.userId, request);
  if (target) await refreshPublicProjectImages(env, target.project_id);
  return { kind: "ok" as const, data };
}

export async function adminUpdateRecommendation(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
  update: Parameters<typeof updateAdminRecommendation>[3],
) {
  const auth = await reviewer(env, authorization, true);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await updateAdminRecommendation(env.DB, id, auth.session.userId, update, false) };
}

export async function adminDeleteRecommendation(env: DataEnv, authorization: string | undefined, id: string) {
  const auth = await reviewer(env, authorization, true);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await deleteAdminRecommendation(env.DB, id, auth.session.userId) };
}

export async function adminRecheck(env: DataEnv, authorization: string | undefined, id: string) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return requeueAdminSubmission(env.DB, id);
}

export async function adminSubmissionFileFetch(
  request: Request,
  env: DataEnv,
  context: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/api\/v1\/admin\/submissions\/([^/]+)\/files\/(worldbook|regex|cover)$/.exec(url.pathname);
  if (request.method !== "GET" || !match) return new Response(null, { status: 404 });
  const auth = await reviewer(env, request.headers.get("authorization") ?? undefined);
  if (auth.kind !== "ok") {
    const status = auth.kind === "unauthorized" ? 401 : 403;
    return Response.json({ error: { code: auth.kind, message: "Reviewer access required" } }, { status });
  }
  let submissionId: string;
  try {
    submissionId = decodeURIComponent(match[1]!);
  } catch {
    return Response.json({ error: { code: "not_found", message: "File not found" } }, { status: 404 });
  }
  const kind = match[2] as "worldbook" | "regex" | "cover";
  const asset = await getSubmissionAsset(env.DB, submissionId, kind);
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
