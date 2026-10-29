import type { RatingInput } from "@workshop/contracts";
import { listAuthorProjects, listAuthorSubmissions } from "../storage/authoring.js";
import { getMe, revokeSessionByToken, sha256Hex } from "../storage/identity.js";
import * as interactions from "../storage/interactions.js";
import type { NewOAuthFlow } from "../storage/oauth.js";
import * as oauth from "../storage/oauth.js";
import { getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env";

export async function identityCreateFlow(env: DataEnv, flow: NewOAuthFlow) {
  await oauth.insertOAuthFlow(env.DB, flow);
}

export async function identityFlowStatus(env: DataEnv, id: string, bindings: string[], deviceSecret: string) {
  const flow = await oauth.getFlowById(env.DB, id);
  if (!flow) return null;
  const hashes = await Promise.all(bindings.map(sha256Hex));
  if (flow.mode !== "browser" && (!flow.browser_binding_hash || !hashes.includes(flow.browser_binding_hash)))
    return null;
  if (
    flow.mode === "device" &&
    (!deviceSecret || !flow.redeem_hash || (await sha256Hex(deviceSecret)) !== flow.redeem_hash)
  )
    return null;
  const expired = flow.status === "pending" && Date.parse(flow.expires_at) <= Date.now();
  if (expired)
    await env.DB.prepare("UPDATE oauth_flows SET status = 'expired' WHERE id = ? AND status = 'pending'")
      .bind(flow.id)
      .run();
  return {
    status: expired ? ("expired" as const) : flow.status,
    expiresAt: flow.expires_at,
    ...(flow.error ? { error: flow.error } : {}),
  };
}

export async function identityFlowByState(env: DataEnv, state: string) {
  return oauth.getFlowByState(env.DB, state);
}

export async function identityFlowError(env: DataEnv, id: string, error: string) {
  await oauth.markFlowError(env.DB, id, error);
}

export async function identityAuthorizeFlow(
  env: DataEnv,
  flowId: string,
  user: { id: string; username: string; global_name?: string | null; avatar?: string | null },
  guildId: string,
  redeemCode: string | null,
) {
  const flow = await oauth.getFlowById(env.DB, flowId);
  if (!flow) return null;
  await oauth.upsertDiscordUser(env.DB, user);
  if (!(await oauth.markFlowAuthorized(env.DB, flow.id, user.id, guildId, redeemCode))) return null;
  if (flow.mode !== "browser") return { token: null };
  const { token } = await oauth.createOpaqueSession(env.DB, user.id, env.SESSION_HASH_SECRET);
  await oauth.markFlowRedeemed(env.DB, flow.id);
  return { token };
}

export async function identityRedeemFlow(
  env: DataEnv,
  flowId: string,
  bindings: string[],
  input: { deviceCode?: string; code?: string; verifier?: string },
) {
  const flow = await oauth.getFlowById(env.DB, flowId);
  if (!flow) return { ok: false as const, error: "not_ready" as const };
  const hashes = await Promise.all(bindings.map(sha256Hex));
  if (flow.mode !== "browser" && (!flow.browser_binding_hash || !hashes.includes(flow.browser_binding_hash)))
    return { ok: false as const, error: "binding" as const };
  if (flow.status !== "authorized" || !flow.user_id) return { ok: false as const, error: "not_ready" as const };
  if (Date.parse(flow.expires_at) <= Date.now()) return { ok: false as const, error: "expired" as const };
  let secretOk = false;
  if (flow.mode === "device") {
    secretOk = Boolean(
      input.deviceCode && flow.redeem_hash && (await sha256Hex(input.deviceCode)) === flow.redeem_hash,
    );
  } else if (flow.mode === "embed" && input.code && input.verifier && flow.redeem_hash && flow.code_challenge) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.verifier));
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    const challenge = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    secretOk = (await sha256Hex(input.code)) === flow.redeem_hash && challenge === flow.code_challenge;
  }
  if (!secretOk) return { ok: false as const, error: "secret" as const };
  if (!(await oauth.markFlowRedeemed(env.DB, flow.id))) return { ok: false as const, error: "redeemed" as const };
  const { token, expiresAt } = await oauth.createOpaqueSession(env.DB, flow.user_id, env.SESSION_HASH_SECRET);
  const me = await getMe(env.DB, flow.user_id);
  if (!me) return { ok: false as const, error: "user_not_found" as const };
  return { ok: true as const, token, expiresAt, user: me.user };
}

export type IdentityMeOperation =
  | { kind: "me" }
  | { kind: "projects" }
  | { kind: "submissions"; projectId: string }
  | { kind: "subscriptions" }
  | { kind: "state"; ids: string[] }
  | { kind: "like"; projectId: string; enabled: boolean }
  | { kind: "subscription"; projectId: string; enabled: boolean }
  | { kind: "rating"; projectId: string; input: RatingInput | null | "invalid_json" | "invalid_rating" };

export async function identitySession(env: DataEnv, token: string) {
  const session = await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET);
  if (!session) return null;
  const { tokenHash: _tokenHash, ...publicSession } = session;
  return publicSession;
}

export async function identityRevoke(env: DataEnv, token: string) {
  if (!(await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET))) return false;
  await revokeSessionByToken(env.DB, token, env.SESSION_HASH_SECRET);
  return true;
}

export async function identityMe(env: DataEnv, token: string, operation: IdentityMeOperation) {
  if (!token) return { ok: false as const, error: "unauthorized" as const };
  const session = await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET);
  if (!session) return { ok: false as const, error: "unauthorized" as const };
  switch (operation.kind) {
    case "me": {
      const data = await getMe(env.DB, session.userId);
      return data ? { ok: true as const, data } : { ok: false as const, error: "unauthorized" as const };
    }
    case "projects":
      return { ok: true as const, data: { items: await listAuthorProjects(env.DB, session) } };
    case "submissions": {
      const items = await listAuthorSubmissions(env.DB, session, operation.projectId);
      return items ? { ok: true as const, data: { items } } : { ok: false as const, error: "not_found" as const };
    }
    case "subscriptions":
      return { ok: true as const, data: { items: await interactions.listSubscribedProjects(env.DB, session.userId) } };
    case "state":
      if (operation.ids.length > 50) return { ok: false as const, error: "too_many_ids" as const };
      return { ok: true as const, data: await interactions.getInteractionState(env.DB, session.userId, operation.ids) };
    case "like":
    case "subscription":
    case "rating": {
      if (!(await interactions.interactionProjectExists(env.DB, operation.projectId)))
        return { ok: false as const, error: "not_found" as const };
      if (operation.kind === "rating" && typeof operation.input === "string")
        return { ok: false as const, error: operation.input };
      if (operation.kind === "like") {
        if (operation.enabled) await interactions.setLike(env.DB, session.userId, operation.projectId);
        else await interactions.unsetLike(env.DB, session.userId, operation.projectId);
      } else if (operation.kind === "subscription") {
        if (operation.enabled) await interactions.setSubscription(env.DB, session.userId, operation.projectId);
        else await interactions.unsetSubscription(env.DB, session.userId, operation.projectId);
      } else if (operation.input && typeof operation.input !== "string")
        await interactions.setRating(env.DB, session.userId, operation.projectId, operation.input);
      else await interactions.unsetRating(env.DB, session.userId, operation.projectId);
      return { ok: true as const, data: null };
    }
  }
}
