import type { MeResponse, Role } from "@workshop/contracts";
import type { AuthFlowMode, AuthFlowStatus } from "@workshop/contracts";

interface UserRow {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  role: Role;
}

interface FlowRow {
  status: AuthFlowStatus["status"];
  expires_at: string;
}

function avatarUrl(userId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  if (avatar.startsWith("https://")) return avatar;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`;
}

export async function getMe(db: D1Database, userId: string): Promise<MeResponse | null> {
  const row = await db.prepare(
    "SELECT id, username, global_name, avatar, role FROM users WHERE id = ?",
  ).bind(userId).first<UserRow>();
  if (!row) return null;
  return {
    user: {
      id: row.id,
      username: row.username,
      globalName: row.global_name,
      avatarUrl: avatarUrl(row.id, row.avatar),
      role: row.role,
    },
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export interface NewAuthFlow {
  id: string;
  state: string;
  verifier?: string;
  codeChallenge?: string;
  origin: string;
  mode: AuthFlowMode;
  expiresAt: string;
}

export async function insertAuthFlow(db: D1Database, flow: NewAuthFlow): Promise<void> {
  const stateHash = await sha256Hex(flow.state);
  const challenge = flow.codeChallenge ?? (flow.verifier ? await sha256Hex(flow.verifier) : null);
  await db.prepare(`
    INSERT INTO oauth_flows (id, state_hash, verifier_hash, origin, mode, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(flow.id, stateHash, challenge, flow.origin, flow.mode, flow.expiresAt).run();
}

export async function getAuthFlowStatus(db: D1Database, id: string): Promise<AuthFlowStatus | null> {
  const row = await db.prepare(
    "SELECT status, expires_at FROM oauth_flows WHERE id = ?",
  ).bind(id).first<FlowRow>();
  if (!row) return null;
  const expired = row.status === "pending" && Date.parse(row.expires_at) <= Date.now();
  if (expired) {
    await db.prepare("UPDATE oauth_flows SET status = 'expired' WHERE id = ? AND status = 'pending'")
      .bind(id).run();
  }
  return { status: expired ? "expired" : row.status, expiresAt: row.expires_at };
}

export async function revokeSessionByToken(db: D1Database, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
  ).bind(new Date().toISOString(), tokenHash).run();
}
