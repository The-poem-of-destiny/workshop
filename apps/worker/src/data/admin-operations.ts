import {
  type AdminAuditEvent,
  type AdminProjectList,
  type AdminSubmissionDetail,
  type AuditAction,
  adminProjectListSchema,
  adminSubmissionDetailSchema,
  type ProjectType,
  type SubmissionDiff,
  submissionDiffSchema,
} from "@workshop/contracts";
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

type RpcJson = string | number | boolean | object | null;

type RpcAuditEvent =
  | Exclude<AdminAuditEvent, { action: "site.update" }>
  | (Omit<Extract<AdminAuditEvent, { action: "site.update" }>, "detail"> & {
      detail: { before: Record<string, RpcJson>; after: Record<string, RpcJson> };
    });

type RpcEntryChange = {
  entryKey: string;
  name: string;
  before: Record<string, RpcJson> | null;
  after: Record<string, RpcJson> | null;
};

type RpcDiffKind = {
  added: RpcEntryChange[];
  modified: Array<RpcEntryChange & { changedFields?: string[] }>;
  deleted: RpcEntryChange[];
  unchanged: number;
  entries: Array<{ entryKey: string; name: string; value: Record<string, RpcJson> }>;
};

type RpcSubmissionDiff = Omit<SubmissionDiff, "metadata" | "worldbook" | "regex"> & {
  metadata: { before: Record<string, RpcJson> | null; after: Record<string, RpcJson> };
  worldbook: RpcDiffKind;
  regex: RpcDiffKind;
};

type RpcAdminSubmissionDetail = Omit<AdminSubmissionDetail, "submission"> & {
  submission: Omit<AdminSubmissionDetail["submission"], "checkReport"> & { checkReport: RpcJson };
};

export async function adminListProjects(
  env: DataEnv,
  authorization: string | undefined,
  limit: number,
  cursor: string | undefined,
  filters: { search?: string; projectType?: ProjectType; includeDeleted?: boolean },
): Promise<{ kind: "unauthorized" } | { kind: "forbidden" } | { kind: "ok"; data: AdminProjectList }> {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  return {
    kind: "ok" as const,
    data: adminProjectListSchema.parse(await listAdminProjects(env.DB, limit, cursor, filters)),
  };
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
): Promise<
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "ok"; data: { items: RpcAuditEvent[]; nextCursor: string | null } }
> {
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

export async function adminGetSubmission(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
): Promise<{ kind: "unauthorized" } | { kind: "forbidden" } | { kind: "ok"; data: RpcAdminSubmissionDetail | null }> {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  const raw = await getAdminSubmission(env.DB, env.R2, id);
  return { kind: "ok" as const, data: raw ? adminSubmissionDetailSchema.parse(raw) : null };
}

export async function adminGetDiff(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
): Promise<{ kind: "unauthorized" } | { kind: "forbidden" } | { kind: "ok"; data: RpcSubmissionDiff | null }> {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  const raw = await getSubmissionDiff(env.DB, env.R2, id);
  return { kind: "ok" as const, data: raw ? submissionDiffSchema.parse(raw) : null };
}

export async function adminReview(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
  request: Parameters<typeof reviewAdminSubmission>[3],
) {
  const auth = await reviewer(env, authorization);
  if (auth.kind !== "ok") return auth;
  const data = await reviewAdminSubmission(
    env.DB,
    id,
    auth.session.userId,
    request,
    env.PUBLIC_COVERS ? (projectId) => withdrawPublicCover(env, projectId) : undefined,
  );
  if (data.kind === "ok" && request.decision === "approve") {
    await refreshPublicProjectImages(env, data.projectId);
  }
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

export async function adminDeleteRecommendation(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
  recommendationId?: string,
) {
  const auth = await reviewer(env, authorization, true);
  if (auth.kind !== "ok") return auth;
  return {
    kind: "ok" as const,
    data: await deleteAdminRecommendation(env.DB, id, auth.session.userId, undefined, recommendationId),
  };
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
