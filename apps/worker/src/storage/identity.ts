import type { AuthFlowMode, AuthFlowStatus, MeResponse, Role } from "@workshop/contracts";
import { hashSessionToken } from "./session-hash.js";

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
  error: string | null;
  mode: AuthFlowMode;
  redeem_hash: string | null;
}

function avatarUrl(userId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  if (avatar.startsWith("https://")) return avatar;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`;
}

export async function getMe(db: D1Database, userId: string): Promise<MeResponse | null> {
  const row = await db
    .prepare("SELECT id, username, global_name, avatar, role FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
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
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getAuthFlowStatus(
  db: D1Database,
  id: string,
  deviceSecret?: string,
): Promise<AuthFlowStatus | null> {
  const row = await db
    .prepare("SELECT status, expires_at, error, mode, redeem_hash FROM oauth_flows WHERE id = ?")
    .bind(id)
    .first<FlowRow>();
  if (!row) return null;
  if (row.mode === "device") {
    if (!deviceSecret || !row.redeem_hash || (await sha256Hex(deviceSecret)) !== row.redeem_hash) return null;
  }
  const expired = row.status === "pending" && Date.parse(row.expires_at) <= Date.now();
  if (expired) {
    await db.prepare("UPDATE oauth_flows SET status = 'expired' WHERE id = ? AND status = 'pending'").bind(id).run();
  }
  return {
    status: expired ? "expired" : row.status,
    expiresAt: row.expires_at,
    ...(row.error ? { error: row.error } : {}),
  };
}

export async function revokeSessionByToken(db: D1Database, token: string, secret?: string): Promise<void> {
  const tokenHash = await hashSessionToken(token, secret);
  await db
    .prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), tokenHash)
    .run();
}
