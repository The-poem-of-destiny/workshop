import { Hono } from "hono";
import { adminSiteUpdateSchema } from "@workshop/contracts";
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
