export type DownloadResult = "counted" | "duplicate" | "not_found";

export async function recordDownload(
  db: D1Database,
  projectId: string,
  userId: string,
): Promise<DownloadResult> {
  const project = await db.prepare(`
    SELECT 1 AS found FROM projects
    WHERE id = ? AND visibility = 'public' AND published_revision_id IS NOT NULL AND deleted_at IS NULL
  `).bind(projectId).first<{ found: number }>();
  if (!project) return "not_found";

  const dayKey = new Date().toISOString().slice(0, 10);
  const inserted = await db.prepare(`
    INSERT OR IGNORE INTO download_events (user_id, project_id, day_key)
    VALUES (?, ?, ?)
  `).bind(userId, projectId, dayKey).run();
  return inserted.meta.changes === 0 ? "duplicate" : "counted";
}

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
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
  files: ReadonlyArray<{ kind: "worldbook" | "regex" }>,
  ttlMs: number,
): Promise<DownloadTicket[]> {
  if (files.length === 0) return [];
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs).toISOString();
  const tickets = files.map(file => ({ kind: file.kind, token: newToken(), expiresAt }));
  const hashes = await Promise.all(tickets.map(ticket => tokenHash(ticket.token)));
  await db.batch(tickets.map((ticket, index) =>
    db.prepare(`
      INSERT INTO download_tokens (token_hash, user_id, project_id, revision_id, kind, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(hashes[index]!, userId, projectId, revisionId, ticket.kind, expiresAt),
  ));
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
  session: { userId: string; role: string },
): Promise<"not_found" | "expired" | ConsumedDownload> {
  const hash = await tokenHash(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT t.user_id, t.expires_at, t.consumed_at, a.r2_key, a.mime, a.bytes
    FROM download_tokens t
    JOIN assets a
      ON a.project_id = t.project_id AND a.revision_id = t.revision_id AND a.kind = t.kind
    JOIN projects p ON p.id = t.project_id
    WHERE t.token_hash = ?
      AND t.user_id = ?
      AND t.consumed_at IS NULL
      AND t.expires_at > ?
      AND p.deleted_at IS NULL
      AND p.published_revision_id = t.revision_id
      AND (p.visibility = 'public' OR p.author_id = ? OR ? IN ('reviewer', 'owner'))
  `).bind(hash, session.userId, now, session.userId, session.role)
    .first<{ user_id: string; expires_at: string; consumed_at: string | null; r2_key: string; mime: string; bytes: number }>();
  if (!row) {
    const expired = await db.prepare("SELECT expires_at, consumed_at FROM download_tokens WHERE token_hash = ? AND user_id = ?")
      .bind(hash, session.userId).first<{ expires_at: string; consumed_at: string | null }>();
    if (expired && !expired.consumed_at && expired.expires_at <= now) return "expired";
    return "not_found";
  }

  const consumed = await db.prepare(`
    UPDATE download_tokens SET consumed_at = ?
    WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
  `).bind(now, hash, now).run();
  if (consumed.meta.changes === 0) return "not_found";

  const object = await r2.get(row.r2_key);
  if (!object) return "not_found";
  return {
    object,
    mime: row.mime,
    bytes: row.bytes,
    filename: row.r2_key.split("/").pop() ?? "download",
  };
}
