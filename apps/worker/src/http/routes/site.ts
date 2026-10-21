import { Hono } from "hono";
import { adminSiteUpdateSchema } from "@workshop/contracts";
import { WORKSHOP_LIMITS, detectImageDimensions } from "@workshop/domain";
import type { Env } from "../../env";
import { updateAdminSite } from "../../storage/admin.js";
import { getBanner, getSiteContent } from "../../storage/home.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";
export const siteRoutes = new Hono<{ Bindings: Env }>();

siteRoutes.get("/", async c => c.json({
  banner: await getBanner(c.env.DB),
  siteContent: await getSiteContent(c.env.DB),
}));

siteRoutes.post("/banner", async c => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  if (session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const mime = (c.req.header("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  const allowed = ["image/png", "image/jpeg", "image/webp"];
  if (!allowed.includes(mime)) return jsonError(c, "unsupported_media_type", "Unsupported content type");
  const body = await c.req.raw.arrayBuffer();
  if (body.byteLength === 0) return jsonError(c, "bad_request", "Empty banner");
  if (body.byteLength > WORKSHOP_LIMITS.projectUploadBytes) return jsonError(c, "payload_too_large", "Banner is too large");
  const dimensions = detectImageDimensions(new Uint8Array(body));
  if (!dimensions) return jsonError(c, "bad_request", "无法识别 Banner 图片尺寸");
  if (dimensions.width > WORKSHOP_LIMITS.coverMaxDimension || dimensions.height > WORKSHOP_LIMITS.coverMaxDimension) {
    return jsonError(c, "payload_too_large", "Banner 尺寸不能超过 4096×4096");
  }
  const digest = await crypto.subtle.digest("SHA-256", body);
  const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
  const key = `banners/${sha256}.${ext}`;
  await c.env.R2.put(key, body, { httpMetadata: { contentType: mime } });
  const current = await getBanner(c.env.DB);
  const banner = {
    imageUrl: `/api/v1/assets/${key}`,
    positionX: current?.positionX ?? 50,
    positionY: current?.positionY ?? 50,
    zoom: current?.zoom ?? 1,
    mobilePositionX: current?.mobilePositionX ?? 50,
    mobilePositionY: current?.mobilePositionY ?? 50,
    mobileZoom: current?.mobileZoom ?? 1,
  };
  const result = await updateAdminSite(c.env.DB, session.userId, banner, undefined);
  return c.json({ banner: result.banner ?? banner }, 201);
});

siteRoutes.put("/", async c => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  if (session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  let body: unknown;
  try {
    body = await c.req.json<unknown>();
  } catch {
    body = undefined;
  }
  const parsed = adminSiteUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid site settings", parsed.error.flatten());
  if (parsed.data.banner === undefined && parsed.data.siteContent === undefined) {
    return jsonError(c, "bad_request", "No site settings provided");
  }
  const result = await updateAdminSite(c.env.DB, session.userId, parsed.data.banner, parsed.data.siteContent);
  return c.json({
    banner: result.banner ?? await getBanner(c.env.DB),
    siteContent: result.siteContent === undefined ? await getSiteContent(c.env.DB) : result.siteContent,
  });
});
