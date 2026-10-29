import { fetchImmutableObject } from "../data-client.js";
import { getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env.js";

async function privateImageHash(request: Request, env: DataEnv, key: string, gallery: boolean): Promise<string | null> {
  const authorization = request.headers.get("authorization");
  const session = authorization?.startsWith("Bearer ")
    ? await getSessionByToken(env.DB, authorization.slice(7), env.SESSION_HASH_SECRET)
    : null;
  if (!session) return null;
  const sql = gallery
    ? `SELECT g.sha256 FROM project_gallery g JOIN projects p ON p.id = g.project_id WHERE g.r2_key = ? AND p.deleted_at IS NULL AND (p.author_id = ? OR ? = 'owner') LIMIT 1`
    : `SELECT a.sha256 FROM assets a JOIN projects p ON p.id = a.project_id WHERE a.r2_key = ? AND a.kind = 'cover' AND p.deleted_at IS NULL AND (((p.author_id = ? OR ? = 'owner') AND (a.revision_id = p.working_revision_id OR a.id = p.published_cover_asset_id)) OR (? IN ('reviewer', 'owner') AND a.revision_id IS NOT NULL AND EXISTS (SELECT 1 FROM submissions s WHERE s.revision_id = a.revision_id AND s.status IN ('pending', 'checking')))) LIMIT 1`;
  const statement = env.DB.prepare(sql);
  const association = await (gallery
    ? statement.bind(key, session.userId, session.role)
    : statement.bind(key, session.userId, session.role, session.role)
  ).first<{ sha256: string }>();
  return association?.sha256 ?? null;
}

async function registeredBanner(env: DataEnv): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'discover_banner'").first<{
    value: string;
  }>();
  try {
    const parsed = row ? (JSON.parse(row.value) as { imageUrl?: unknown }) : null;
    if (typeof parsed?.imageUrl !== "string") return null;
    const path = parsed.imageUrl.startsWith("http") ? new URL(parsed.imageUrl).pathname : parsed.imageUrl;
    return path.replace(/^\/api\/v1\/(?:public-assets|assets)\//, "");
  } catch {
    return null;
  }
}

export async function distributionImage(request: Request, env: DataEnv, context?: ExecutionContext): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const publicOnly = pathname.startsWith("/api/v1/public-assets/");
  const key = pathname.replace(/^\/api\/v1\/(?:public-assets|assets)\//, "");
  const missing = () =>
    Response.json(
      { error: { code: "not_found", message: "Asset not found" } },
      {
        status: 404,
        headers: {
          "cache-control": "private, no-store",
          ...(publicOnly ? { "access-control-allow-origin": "*" } : {}),
        },
      },
    );
  let sha256: string | null = null;
  if (!key.startsWith("covers/") && !key.startsWith("gallery/") && !key.startsWith("banners/")) return missing();
  if (key.startsWith("banners/")) {
    if ((await registeredBanner(env)) !== key) return missing();
  } else {
    const gallery = key.startsWith("gallery/");
    const publicSql = gallery
      ? `SELECT g.sha256 FROM project_gallery g JOIN projects p ON p.id = g.project_id WHERE g.r2_key = ? AND p.deleted_at IS NULL AND p.visibility = 'public' AND p.published_revision_id IS NOT NULL LIMIT 1`
      : `SELECT a.sha256 FROM assets a JOIN projects p ON p.id = a.project_id WHERE a.r2_key = ? AND a.kind = 'cover' AND p.deleted_at IS NULL AND p.visibility = 'public' AND p.published_revision_id IS NOT NULL AND ((a.id = p.published_cover_asset_id AND a.revision_id IS NULL) OR (p.published_cover_asset_id IS NULL AND a.revision_id = p.published_revision_id)) LIMIT 1`;
    const publicAssociation = await env.DB.prepare(publicSql).bind(key).first<{ sha256: string }>();
    if (!publicAssociation) {
      if (publicOnly) return missing();
      sha256 = await privateImageHash(request, env, key, gallery);
      if (sha256 === null) return missing();
    } else {
      sha256 = publicAssociation.sha256;
    }
  }
  if (context && sha256 && /^[a-f0-9]{64}$/.test(sha256)) {
    const object = await fetchImmutableObject(context, { r2Key: key, sha256, identity: key });
    if (object.status === 404) {
      await object.body?.cancel();
      return missing();
    }
    if (!object.ok) {
      await object.body?.cancel();
      throw new Error("Failed to read image object");
    }
    return new Response(object.body, {
      headers: {
        "content-type": object.headers.get("content-type") ?? "application/octet-stream",
        ...(object.headers.has("content-length") ? { "content-length": object.headers.get("content-length")! } : {}),
        "cache-control": publicOnly ? "public, max-age=300, stale-if-error=0" : "private, no-store",
        ...(publicOnly ? { "access-control-allow-origin": "*" } : { vary: "Authorization" }),
      },
    });
  }
  const object = await env.R2.get(key);
  if (!object) return missing();
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "content-length": String(object.size),
      "cache-control": publicOnly ? "public, max-age=300, stale-if-error=0" : "private, no-store",
      ...(publicOnly ? { "access-control-allow-origin": "*" } : { vary: "Authorization" }),
    },
  });
}
