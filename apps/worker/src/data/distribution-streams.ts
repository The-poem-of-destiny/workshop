import { WORKSHOP_LIMITS } from "@workshop/domain";
import { type ClientAsset, clientChannelAsset, versionedClientAsset } from "../cache/public-cache";
import { updateAdminSite } from "../storage/admin-site.js";
import { bannerSourceUrl, getBanner, projectBanner, readBannerState } from "../storage/home.js";
import { getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env.js";
import { replicatePublicBanner, withdrawPublicBanner } from "./public-banner.js";
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
  if (!session.policyAccepted || session.role !== "owner") return error(403, "forbidden", "Owner role required");
  const mime = (request.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime))
    return error(415, "unsupported_media_type", "Unsupported content type");
  if (!request.body) return error(400, "bad_request", "Empty banner");
  const current = await readBannerState(env.DB);
  const image = streamImage(request.body, WORKSHOP_LIMITS.bannerUploadBytes);
  let staged: StagedStream;
  try {
    staged = await stageStream(
      env.R2,
      image.body,
      WORKSHOP_LIMITS.bannerUploadBytes,
      Number(request.headers.get("content-length")),
    );
  } catch (cause) {
    if (
      cause instanceof UploadLimitError ||
      (cause instanceof RangeError && cause.message === "Upload exceeds staging size")
    )
      return error(413, "payload_too_large", "Banner is too large");
    throw cause;
  }
  try {
    const { bytes, dimensions, sha256 } = await image.result;
    if (!bytes) return error(400, "bad_request", "Empty banner");
    if (!dimensions || dimensions.mime !== mime)
      return error(400, "bad_request", "无法识别 Banner 图片格式或格式与类型不匹配");
    if (dimensions.width > WORKSHOP_LIMITS.coverMaxDimension || dimensions.height > WORKSHOP_LIMITS.coverMaxDimension)
      return error(413, "payload_too_large", "Banner 尺寸不能超过 4096×4096");
    const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
    const key = `banners/${sha256}.${ext}`;
    const imageUrl = `/api/v1/public-assets/${key}`;
    const banner = { ...projectBanner(current), imageUrl };
    await staged.copyTo(key, { httpMetadata: { contentType: mime } });
    if (
      (imageUrl !== bannerSourceUrl(current) && !(await withdrawPublicBanner(env, current))) ||
      !(await updateAdminSite(env.DB, session.userId, { banner, current }, undefined))
    ) {
      return error(409, "conflict", "Banner changed or is being updated; refresh and try again");
    }
    await replicatePublicBanner(env, imageUrl);
    return Response.json(
      { banner: await getBanner(env.DB, env) },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } finally {
    await staged.dispose();
  }
}

function missingClientAsset(checker: boolean): Response {
  return Response.json(
    { error: { code: "not_found", message: checker ? "Checker asset not found" : "Client asset not found" } },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

export function distributionClientAsset(request: Request, env: DataEnv): Promise<Response> | Response {
  const pathname = new URL(request.url).pathname;
  const asset = versionedClientAsset(pathname) ?? clientChannelAsset(pathname);
  return asset
    ? readClientAsset(asset, env, request.headers.get("if-none-match"))
    : missingClientAsset(pathname.startsWith("/client/checker/"));
}

export async function readClientAsset(
  asset: ClientAsset,
  env: DataEnv,
  ifNoneMatch?: string | null,
): Promise<Response> {
  const object = await env.R2.get(asset.key);
  if (!object) return missingClientAsset(asset.key.startsWith("checker/"));
  const headers = new Headers({
    "content-type": asset.contentType,
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
    "x-content-type-options": "nosniff",
    "cache-control": asset.immutable ? "public, max-age=31536000, immutable" : "no-store",
    etag: object.httpEtag,
  });
  if (ifNoneMatch === object.httpEtag) {
    await object.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
}
