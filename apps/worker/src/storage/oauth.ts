import type { AuthFlowMode, Session } from "@workshop/contracts";
import { sha256Hex } from "./identity.js";
import { hashSessionToken } from "./session-hash.js";

export interface AuthFlowRow {
  id: string;
  state_hash: string;
  code_verifier: string | null;
  code_challenge: string | null;
  redeem_hash: string | null;
  origin: string;
  mode: AuthFlowMode;
  status: "pending" | "authorized" | "redeemed" | "expired";
  user_id: string | null;
  guild_id: string | null;
  error: string | null;
  expires_at: string;
  consumed_at: string | null;
  authorized_at: string | null;
  browser_binding_hash: string | null;
}

export interface NewOAuthFlow {
  id: string;
  state: string;
  verifier: string;
  codeChallenge: string | null;
  redeemHash: string | null;
  origin: string;
  mode: AuthFlowMode;
  expiresAt: string;
  browserBindingHash: string;
}

export async function insertOAuthFlow(db: D1Database, flow: NewOAuthFlow): Promise<void> {
  await db
    .prepare(`
    INSERT INTO oauth_flows
      (id, state_hash, code_verifier, code_challenge, redeem_hash, origin, mode, expires_at, browser_binding_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      flow.id,
      await sha256Hex(flow.state),
      flow.verifier,
      flow.codeChallenge,
      flow.redeemHash,
      flow.origin,
      flow.mode,
      flow.expiresAt,
      flow.browserBindingHash,
    )
    .run();
}

export async function getFlowByState(db: D1Database, state: string): Promise<AuthFlowRow | null> {
  return db
    .prepare("SELECT * FROM oauth_flows WHERE state_hash = ?")
    .bind(await sha256Hex(state))
    .first<AuthFlowRow>();
}

export async function getFlowById(db: D1Database, id: string): Promise<AuthFlowRow | null> {
  return db.prepare("SELECT * FROM oauth_flows WHERE id = ?").bind(id).first<AuthFlowRow>();
}

export async function markFlowAuthorized(
  db: D1Database,
  flowId: string,
  userId: string,
  guildId: string,
  redeemCode: string | null,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(`
    UPDATE oauth_flows
    SET status = 'authorized', user_id = ?, guild_id = ?, redeem_hash = COALESCE(?, redeem_hash), authorized_at = ?, error = NULL
    WHERE id = ? AND status = 'pending' AND expires_at > ? AND consumed_at IS NULL
  `)
    .bind(userId, guildId, redeemCode ? await sha256Hex(redeemCode) : null, now, flowId, now)
    .run();
  return result.meta.changes > 0;
}

export async function markFlowError(db: D1Database, flowId: string, error: string): Promise<void> {
  await db.prepare("UPDATE oauth_flows SET error = ? WHERE id = ? AND status = 'pending'").bind(error, flowId).run();
}

export async function markFlowRedeemed(db: D1Database, flowId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(`
    UPDATE oauth_flows
    SET status = 'redeemed', consumed_at = ?
    WHERE id = ? AND status = 'authorized' AND consumed_at IS NULL AND expires_at > ?
  `)
    .bind(now, flowId, now)
    .run();
  return result.meta.changes > 0;
}

export async function upsertDiscordUser(
  db: D1Database,
  user: { id: string; username: string; global_name?: string | null; avatar?: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(`
    INSERT INTO users (id, username, global_name, avatar, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'member', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      global_name = excluded.global_name,
      avatar = excluded.avatar,
      updated_at = excluded.updated_at
  `)
    .bind(user.id, user.username, user.global_name ?? null, user.avatar ?? null, now, now)
    .run();
}

export async function createOpaqueSession(
  db: D1Database,
  userId: string,
  sessionSecret?: string,
  ttlMs = 30 * 24 * 60 * 60 * 1000,
): Promise<{ token: string; expiresAt: string; session: Session }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const now = new Date().toISOString();
  await db
    .prepare(`
    INSERT INTO sessions (token_hash, user_id, session_version, created_at, last_seen_at, expires_at)
    VALUES (?, ?, 1, ?, ?, ?)
  `)
    .bind(await hashSessionToken(token, sessionSecret), userId, now, now, expiresAt)
    .run();
  const role = await db.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first<{ role: Session["role"] }>();
  if (!role) throw new Error("Session user not found");
  return {
    token,
    expiresAt,
    session: { userId, role: role.role, sessionVersion: 1, expiresAt },
  };
}
