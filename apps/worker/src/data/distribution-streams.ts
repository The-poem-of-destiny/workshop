import { WORKSHOP_LIMITS } from "@workshop/domain";
import { updateAdminSite } from "../storage/admin-site.js";
import { getBanner } from "../storage/home.js";
import { getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env.js";
import { streamImage, UploadLimitError } from "./streaming-image.js";
import { type StagedStream, stageStream } from "./streaming-staging.js";

export async function distributionBannerUpload(request: Request, env: DataEnv): Promise<Response> {
  const error = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status, headers: { "cache-control": "private, no-store" } });
  const authorization = request.headers.get("authorization");
  const session = authorization?.startsWith("Bearer ")
    ? await getSessionByToken(env.DB, authorization.slice(7), env.SESSION_HASH_SECRET)
    : null;
  if (!session) return error(401, "unauthorized", "Login required");
  if (session.role !== "owner") return error(403, "forbidden", "Owner role required");
  const mime = (request.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime))
    return error(415, "unsupported_media_type", "Unsupported content type");
  if (!request.body) return error(400, "bad_request", "Empty banner");
  const image = streamImage(request.body, WORKSHOP_LIMITS.projectUploadBytes);
  let staged: StagedStream;
  try {
    staged = await stageStream(
      env.R2,
      image.body,
      WORKSHOP_LIMITS.projectUploadBytes,
      Number(request.headers.get("content-length")),
    );
  } catch (cause) {
    if (cause instanceof UploadLimitError) return error(413, "payload_too_large", "Banner is too large");
    throw cause;
  }
  try {
    const { bytes, dimensions, sha256 } = await image.result;
    if (!bytes) return error(400, "bad_request", "Empty banner");
    if (!dimensions) return error(400, "bad_request", "无法识别 Banner 图片尺寸");
    if (dimensions.width > WORKSHOP_LIMITS.coverMaxDimension || dimensions.height > WORKSHOP_LIMITS.coverMaxDimension)
      return error(413, "payload_too_large", "Banner 尺寸不能超过 4096×4096");
    const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
    const key = `banners/${sha256}.${ext}`;
    await staged.copyTo(key, { httpMetadata: { contentType: mime } });
    const current = await getBanner(env.DB);
    const banner = {
      imageUrl: `/api/v1/public-assets/${key}`,
      positionX: current?.positionX ?? 50,
      positionY: current?.positionY ?? 50,
      zoom: current?.zoom ?? 1,
      mobilePositionX: current?.mobilePositionX ?? 50,
      mobilePositionY: current?.mobilePositionY ?? 50,
      mobileZoom: current?.mobileZoom ?? 1,
    };
    const result = await updateAdminSite(env.DB, session.userId, banner, undefined);
    return Response.json(
      { banner: result.banner ?? banner },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } finally {
    await staged.dispose();
  }
}

export async function distributionClientAsset(request: Request, env: DataEnv): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const missing = (checker: boolean) =>
    Response.json(
      { error: { code: "not_found", message: checker ? "Checker asset not found" : "Client asset not found" } },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  const checker = /^\/client\/checker\/v\/([a-f0-9]{8,64})\/([^/]+)$/.exec(pathname);
  const allowed: Record<string, string> = {
    "browser-checker.js": "text/javascript; charset=utf-8",
    "upload-checker.mjs": "text/javascript; charset=utf-8",
    "review-checker.mjs": "text/javascript; charset=utf-8",
    "manifest.json": "application/json; charset=utf-8",
    "NOTICES.txt": "text/plain; charset=utf-8",
  };
  if (pathname.startsWith("/client/checker/")) {
    if (!checker || !allowed[checker[2]!]) return missing(true);
    const object = await env.R2.get(`checker/v/${checker[1]}/${checker[2]}`);
    if (!object) return missing(true);
    const headers = new Headers({
      "content-type": allowed[checker[2]!]!,
      "cache-control": "public, max-age=31536000, immutable",
      "cloudflare-cdn-cache-control": "public, max-age=31536000, immutable",
      "cache-tag": `checker:v:${checker[1]}`,
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
      etag: object.httpEtag,
    });
    if (request.headers.get("if-none-match") === object.httpEtag) {
      await object.body.cancel();
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { headers });
  }
  const path = pathname.replace(/^\/client\/?/, "");
  const versioned = /^v\/([a-f0-9]{8,64})\/index\.js$/.exec(path);
  if (!versioned && !/^(stable|staging)\/index\.js$/.test(path)) return missing(false);
  const object = await env.R2.get(`client/${path}`);
  if (!object) return missing(false);
  const headers = new Headers({
    "content-type": "text/javascript; charset=utf-8",
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
    "x-content-type-options": "nosniff",
    "cache-control": versioned ? "public, max-age=31536000, immutable" : "no-store",
    etag: object.httpEtag,
  });
  if (versioned) {
    headers.set("cloudflare-cdn-cache-control", "public, max-age=31536000, immutable");
    headers.set("cache-tag", `client:v:${versioned[1]}`);
  }
  if (request.headers.get("if-none-match") === object.httpEtag) {
    await object.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
}
