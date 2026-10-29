import type { Hono } from "hono";
import type { Env } from "../../env.js";
import { jsonError, versionConflict } from "../errors.js";
import { ifMatchVersion } from "../if-match.js";
import { sessionOrError } from "./authoring-request.js";

export function registerAuthoringGalleryRoutes(authoringRoutes: Hono<{ Bindings: Env }>) {
  authoringRoutes.get("/:id/gallery", async (c) => {
    const auth = await sessionOrError(c);
    if (!auth.session) return auth.response;
    const response = await c.executionCtx.exports.DataService.authorAdminGetGallery(
      c.req.header("authorization"),
      c.req.param("id"),
    );
    if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    const gallery = response.data;
    if (!gallery) return jsonError(c, "not_found", "Project not found");
    return c.json(gallery);
  });

  authoringRoutes.put("/:id/gallery/:slot", (c) => c.executionCtx.exports.DataService.fetch(c.req.raw));

  authoringRoutes.delete("/:id/gallery/:slot", async (c) => {
    const auth = await sessionOrError(c);
    if (!auth.session) return auth.response;
    const expectedVersion = ifMatchVersion(c.req.header("if-match"));
    const response = await c.executionCtx.exports.DataService.authorAdminDeleteGallery(
      c.req.header("authorization"),
      c.req.param("id"),
      Number(c.req.param("slot")),
      expectedVersion,
    );
    if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (response.kind === "not_found") return jsonError(c, "not_found", "Project not found");
    if (response.kind === "version_conflict") return versionConflict(c, "project", expectedVersion, response.actual);
    const result = response.data;
    if (result.kind === "invalid") return jsonError(c, "bad_request", result.message);
    return c.json(result);
  });
}
