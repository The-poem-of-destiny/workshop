import { fetchImmutableObject } from "../data-client";
import { getReleaseAssets } from "../storage/releases";
import { getSessionByToken } from "../storage/sessions";
import type { DataEnv } from "./env";

export async function download(request: Request, env: DataEnv, context: ExecutionContext): Promise<Response> {
  const headers = { "cache-control": "private, no-store" };
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const session = token ? await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET) : null;
  if (!session)
    return Response.json({ error: { code: "unauthorized", message: "Login required" } }, { status: 401, headers });
  const match = /^\/api\/v1\/downloads\/([^/]+)\/([^/]+)\/(worldbook|regex)$/.exec(new URL(request.url).pathname);
  const missing = () =>
    Response.json({ error: { code: "not_found", message: "Download not found" } }, { status: 404, headers });
  if (!match || request.method !== "GET") return missing();
  const release = await getReleaseAssets(env.DB, decodeURIComponent(match[1]!), decodeURIComponent(match[2]!), session);
  const row = release?.files.find((file) => file.kind === match[3]);
  if (!row) return missing();
  const cacheable =
    /^[a-f0-9]{64}$/.test(row.sha256) && row.r2Key.split("/").pop()?.includes(`-${row.sha256}.`) === true;
  let body: ReadableStream<Uint8Array>;
  if (cacheable) {
    const object = await fetchImmutableObject(context, { r2Key: row.r2Key, sha256: row.sha256, identity: row.r2Key });
    if (!object.ok || !object.body) {
      await object.body?.cancel().catch(() => {});
      return missing();
    }
    body = object.body;
  } else {
    const object = await env.R2.get(row.r2Key);
    if (!object) return missing();
    body = object.body;
  }
  const currentSession = await getSessionByToken(env.DB, token, env.SESSION_HASH_SECRET);
  const current = currentSession
    ? await getReleaseAssets(env.DB, decodeURIComponent(match[1]!), decodeURIComponent(match[2]!), currentSession)
    : null;
  if (
    !current?.files.some((file) => file.kind === row.kind && file.r2Key === row.r2Key && file.sha256 === row.sha256)
  ) {
    await body.cancel().catch(() => {});
    return missing();
  }
  return new Response(body, {
    headers: {
      ...headers,
      "content-type": row.mime,
      "content-length": String(row.bytes),
      "content-disposition": `attachment; filename="${row.r2Key.split("/").pop() ?? "download"}"`,
    },
  });
}
