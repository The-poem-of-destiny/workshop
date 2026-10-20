import type { Session } from "@workshop/contracts";

interface SessionRow {
  user_id: string;
  role: Session["role"];
  session_version: number;
  expires_at: string;
  revoked_at: string | null;
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function getSessionByToken(db: D1Database, token: string): Promise<Session | null> {
  const tokenHash = await hashToken(token);
  const row = await db.prepare(`
    SELECT s.user_id, u.role, s.session_version, s.expires_at, s.revoked_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).bind(tokenHash).first<SessionRow>();

  if (!row || row.revoked_at) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  return {
    userId: row.user_id,
    role: row.role,
    sessionVersion: row.session_version,
    expiresAt: row.expires_at,
  };
}

export async function touchSession(db: D1Database, token: string): Promise<void> {
  const tokenHash = await hashToken(token);
  await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
    .bind(new Date().toISOString(), tokenHash)
    .run();
}
