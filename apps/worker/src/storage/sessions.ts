import type { Session } from "@workshop/contracts";
import { hashSessionToken } from "./session-hash.js";

interface SessionRow {
  user_id: string;
  role: Session["role"];
  session_version: number;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function getSessionByToken(db: D1Database, token: string, secret?: string): Promise<Session | null> {
  const tokenHash = await hashSessionToken(token, secret);
  const row = await db
    .prepare(`
    SELECT s.user_id, u.role, s.session_version, s.expires_at, s.last_seen_at, s.revoked_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `)
    .bind(tokenHash)
    .first<SessionRow>();

  if (!row || row.revoked_at) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) return null;

  let expiresAt = row.expires_at;
  if (now - Date.parse(row.last_seen_at) >= TOUCH_INTERVAL_MS) {
    expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    await db
      .prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?")
      .bind(new Date(now).toISOString(), expiresAt, tokenHash)
      .run();
  }
  return {
    userId: row.user_id,
    role: row.role,
    sessionVersion: row.session_version,
    expiresAt,
  };
}
