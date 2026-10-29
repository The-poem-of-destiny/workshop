import { fetchImmutableObject } from "../data-client";
import { getSessionByToken } from "../storage/sessions";
import type { DataEnv } from "./env";

export async function download(request: Request, env: DataEnv, context: ExecutionContext): Promise<Response> {
  const headers = { "cache-control": "private, no-store" };
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const session = token ? await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET) : null;
  if (!session) {
    return Response.json({ error: { code: "unauthorized", message: "Login required" } }, { status: 401, headers });
  }
  const match = /^\/api\/v1\/downloads\/([^/]+)$/.exec(new URL(request.url).pathname);
  if (!match || request.method !== "GET") {
    return Response.json({ error: { code: "not_found", message: "Download not found" } }, { status: 404, headers });
  }
  const ticket = decodeURIComponent(match[1]!);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`
    SELECT a.r2_key, a.sha256, a.mime, a.bytes
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
      r2_key: string;
      sha256: string | null;
      mime: string;
      bytes: number;
    }>();
  if (!row) {
    return Response.json({ error: { code: "not_found", message: "Download not found" } }, { status: 404, headers });
  }

  const cacheable =
    row.sha256 !== null &&
    /^[a-f0-9]{64}$/.test(row.sha256) &&
    row.r2_key.split("/").pop()?.includes(`-${row.sha256}.`) === true;
  let body: ReadableStream<Uint8Array> | null;
  if (cacheable && row.sha256) {
    const object = await fetchImmutableObject(context, {
      r2Key: row.r2_key,
      sha256: row.sha256,
      identity: row.r2_key,
    });
    if (!object.ok || !object.body) {
      await object.body?.cancel().catch(() => {});
      return Response.json({ error: { code: "not_found", message: "Download not found" } }, { status: 404, headers });
    }
    body = object.body;
  } else {
    const object = await env.R2.get(row.r2_key);
    if (!object) {
      return Response.json({ error: { code: "not_found", message: "Download not found" } }, { status: 404, headers });
    }
    body = object.body;
  }

  let results: D1Result[];
  try {
    results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE download_tokens
        SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE token_hash = ? AND user_id = ? AND session_version = ?
          AND consumed_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          AND EXISTS (
            SELECT 1 FROM projects p
            JOIN users u ON u.id = download_tokens.user_id
            WHERE p.id = download_tokens.project_id
              AND p.deleted_at IS NULL
              AND p.published_revision_id = download_tokens.revision_id
              AND (p.visibility = 'public' OR p.author_id = download_tokens.user_id OR u.role IN ('reviewer', 'owner'))
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
              AND a.r2_key = ? AND a.sha256 IS ?
          )
      `).bind(hash, session.userId, session.sessionVersion, session.tokenHash, row.r2_key, row.sha256),
      env.DB.prepare(`
        INSERT OR IGNORE INTO download_events (user_id, project_id, day_key, created_at)
        SELECT t.user_id, t.project_id, substr(t.consumed_at, 1, 10), t.consumed_at
        FROM download_tokens t
        JOIN projects p ON p.id = t.project_id
        JOIN users u ON u.id = t.user_id
        WHERE changes() = 1 AND t.token_hash = ?
          AND p.visibility = 'public' AND p.deleted_at IS NULL
          AND p.author_id != t.user_id AND u.role NOT IN ('reviewer', 'owner')
      `).bind(hash),
    ]);
  } catch (error) {
    await body.cancel().catch(() => {});
    throw error;
  }
  if ((results[0]?.meta.changes ?? 0) === 0) {
    await body.cancel().catch(() => {});
    return Response.json({ error: { code: "not_found", message: "Download not found" } }, { status: 404, headers });
  }
  return new Response(body, {
    headers: {
      ...headers,
      "content-type": row.mime,
      "content-length": String(row.bytes),
      "content-disposition": `attachment; filename="${row.r2_key.split("/").pop() ?? "download"}"`,
    },
  });
}
