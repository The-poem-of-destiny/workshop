import type { AuthenticatedSession } from "./sessions.js";

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export interface DownloadTicket {
  kind: "worldbook" | "regex";
  token: string;
  expiresAt: string;
}

export async function issueDownloadTickets(
  db: D1Database,
  projectId: string,
  revisionId: string,
  userId: string,
  sessionVersion: number,
  files: ReadonlyArray<{ kind: "worldbook" | "regex" }>,
  ttlMs: number,
): Promise<DownloadTicket[]> {
  if (files.length === 0) return [];
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs).toISOString();
  const tickets = files.map((file) => ({ kind: file.kind, token: newToken(), expiresAt }));
  const hashes = await Promise.all(tickets.map((ticket) => tokenHash(ticket.token)));
  await db.batch(
    tickets.map((ticket, index) =>
      db
        .prepare(`
      INSERT INTO download_tokens (token_hash, user_id, project_id, revision_id, kind, expires_at, session_version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
        .bind(hashes[index]!, userId, projectId, revisionId, ticket.kind, expiresAt, sessionVersion),
    ),
  );
  return tickets;
}

export interface ConsumedDownload {
  object: R2ObjectBody;
  mime: string;
  bytes: number;
  filename: string;
}

export async function consumeDownloadToken(
  db: D1Database,
  r2: R2Bucket,
  token: string,
  session: AuthenticatedSession,
): Promise<"not_found" | "expired" | ConsumedDownload> {
  const hash = await tokenHash(token);
  const now = new Date().toISOString();
  const row = await db
    .prepare(`
    SELECT t.project_id, a.r2_key, a.mime, a.bytes
    FROM download_tokens t
    JOIN assets a
      ON a.project_id = t.project_id AND a.revision_id = t.revision_id AND a.kind = t.kind
    JOIN projects p ON p.id = t.project_id
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
      AND t.user_id = ?
      AND t.session_version = ?
      AND t.consumed_at IS NULL
      AND t.expires_at > ?
      AND p.deleted_at IS NULL
      AND p.published_revision_id = t.revision_id
      AND (p.visibility = 'public' OR p.author_id = t.user_id OR u.role IN ('reviewer', 'owner'))
  `)
    .bind(hash, session.userId, session.sessionVersion, now)
    .first<{
      project_id: string;
      r2_key: string;
      mime: string;
      bytes: number;
    }>();
  if (!row) {
    const expired = await db
      .prepare("SELECT expires_at, consumed_at FROM download_tokens WHERE token_hash = ? AND user_id = ?")
      .bind(hash, session.userId)
      .first<{ expires_at: string; consumed_at: string | null }>();
    if (expired && !expired.consumed_at && expired.expires_at <= now) return "expired";
    return "not_found";
  }

  const object = await r2.get(row.r2_key);
  if (!object) return "not_found";

  const results = await db.batch([
    db
      .prepare(`
      UPDATE download_tokens
      SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE token_hash = ? AND user_id = ? AND session_version = ?
        AND consumed_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND EXISTS (
          SELECT 1
          FROM projects p
          JOIN users u ON u.id = download_tokens.user_id
          WHERE p.id = download_tokens.project_id
            AND p.deleted_at IS NULL
            AND p.published_revision_id = download_tokens.revision_id
            AND (
              p.visibility = 'public'
              OR p.author_id = download_tokens.user_id
              OR u.role IN ('reviewer', 'owner')
            )
        )
        AND EXISTS (
          SELECT 1 FROM sessions s
          WHERE s.token_hash = ?
            AND s.user_id = download_tokens.user_id
            AND s.session_version = download_tokens.session_version
            AND s.revoked_at IS NULL
            AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
        AND EXISTS (
          SELECT 1 FROM assets a
          WHERE a.project_id = download_tokens.project_id
            AND a.revision_id = download_tokens.revision_id
            AND a.kind = download_tokens.kind
            AND a.r2_key = ?
        )
    `)
      .bind(hash, session.userId, session.sessionVersion, session.tokenHash, row.r2_key),
    // Only public release consumption creates the idempotent daily event.
    // Its trigger updates both aggregate count and daily metric in this same
    // D1 transaction; private author/reviewer access remains uncounted.
    db
      .prepare(`
      INSERT OR IGNORE INTO download_events (user_id, project_id, day_key, created_at)
      SELECT t.user_id, t.project_id, substr(t.consumed_at, 1, 10), t.consumed_at
      FROM download_tokens t JOIN projects p ON p.id = t.project_id
      WHERE changes() = 1 AND t.token_hash = ?
        AND p.visibility = 'public' AND p.deleted_at IS NULL
    `)
      .bind(hash),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    await object.body.cancel().catch(() => {});
    return "not_found";
  }
  return {
    object,
    mime: row.mime,
    bytes: row.bytes,
    filename: row.r2_key.split("/").pop() ?? "download",
  };
}
