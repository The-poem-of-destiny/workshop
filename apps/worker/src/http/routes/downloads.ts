import { Hono } from "hono";
import type { Env } from "../../env";
import { consumeDownloadToken } from "../../storage/downloads.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";

export const downloadRoutes = new Hono<{ Bindings: Env }>();

downloadRoutes.get("/:token", async c => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");

  const result = await consumeDownloadToken(c.env.DB, c.env.R2, c.req.param("token"), session);
  if (typeof result === "string") return jsonError(c, "not_found", "Download not found");

  return new Response(result.object.body, {
    headers: {
      "content-type": result.mime,
      "content-length": String(result.bytes),
      "content-disposition": `attachment; filename="${result.filename}"`,
      "cache-control": "private, no-store",
    },
  });
});
