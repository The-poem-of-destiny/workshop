import type { CreateCollection, PatchCollection } from "@workshop/contracts";
import {
  createAuthorCollection,
  getPublicAuthorProfile,
  getPublicCollection,
  listAuthorCollections,
  patchAuthorCollection,
  setProjectCollections,
  softDeleteAuthorCollection,
} from "../storage/collections.js";
import { getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env.js";

async function requirePolicySession(env: DataEnv, tokenOrAuth: string | undefined) {
  const token = tokenOrAuth?.startsWith("Bearer ") ? tokenOrAuth.slice(7) : (tokenOrAuth ?? "");
  if (!token) return { kind: "unauthorized" as const };
  const session = await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET);
  if (!session) return { kind: "unauthorized" as const };
  if (!session.policyAccepted) return { kind: "forbidden" as const };
  return { kind: "ok" as const, session };
}

export function collectionPublicGet(env: DataEnv, collectionId: string) {
  return getPublicCollection(env.DB, collectionId);
}

export function authorPublicProfile(env: DataEnv, authorId: string) {
  return getPublicAuthorProfile(env.DB, authorId);
}

export async function authorListCollections(env: DataEnv, tokenOrAuth: string | undefined) {
  const auth = await requirePolicySession(env, tokenOrAuth);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: { items: await listAuthorCollections(env.DB, auth.session.userId) } };
}

export async function authorCreateCollection(env: DataEnv, authorization: string | undefined, input: CreateCollection) {
  const auth = await requirePolicySession(env, authorization);
  if (auth.kind !== "ok") return auth;
  return createAuthorCollection(env.DB, auth.session, input);
}

export async function authorPatchCollection(
  env: DataEnv,
  authorization: string | undefined,
  collectionId: string,
  input: PatchCollection,
) {
  const auth = await requirePolicySession(env, authorization);
  if (auth.kind !== "ok") return auth;
  return patchAuthorCollection(env.DB, auth.session, collectionId, input);
}

export async function authorDeleteCollection(env: DataEnv, authorization: string | undefined, collectionId: string) {
  const auth = await requirePolicySession(env, authorization);
  if (auth.kind !== "ok") return auth;
  return softDeleteAuthorCollection(env.DB, auth.session, collectionId);
}

export async function authorSetProjectCollections(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  collectionIds: string[],
) {
  const auth = await requirePolicySession(env, authorization);
  if (auth.kind !== "ok") return auth;
  return setProjectCollections(env.DB, auth.session, projectId, collectionIds);
}
