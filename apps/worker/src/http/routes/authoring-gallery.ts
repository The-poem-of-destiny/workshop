import { WORKSHOP_LIMITS } from "@workshop/domain";
import type { Hono } from "hono";
import type { Env } from "../../env.js";
import { getAuthoringProject } from "../../storage/authoring-model.js";
import { deleteGalleryImage, getAuthorGallery, uploadGalleryImage } from "../../storage/project-gallery.js";
import { jsonError, versionConflict } from "../errors.js";
import { ifMatchVersion, sessionOrError } from "./authoring-request.js";

export function registerAuthoringGalleryRoutes(authoringRoutes: Hono<{ Bindings: Env }>) {
  authoringRoutes.get("/:id/gallery", async (c) => {
    const auth = await sessionOrError(c);
    if (!auth.session) return auth.response;
    const gallery = await getAuthorGallery(c.env.DB, c.req.param("id"), auth.session);
    if (!gallery) return jsonError(c, "not_found", "Project not found");
    return c.json(gallery);
  });

  authoringRoutes.put("/:id/gallery/:slot", async (c) => {
    const auth = await sessionOrError(c);
    if (!auth.session) return auth.response;
    const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
    if (!project) return jsonError(c, "not_found", "Project not found");
    const expectedVersion = ifMatchVersion(c.req.header("if-match"));
    if (expectedVersion === null || expectedVersion !== project.row_version) {
      return versionConflict(c, "project", expectedVersion, project.row_version);
    }
    const declaredLength = Number(c.req.header("content-length"));
    if (!Number.isFinite(declaredLength) || declaredLength <= 0)
      return jsonError(c, "bad_request", "Content-Length required");
    if (declaredLength > WORKSHOP_LIMITS.projectImageUploadBytes) {
      return jsonError(c, "payload_too_large", "Gallery image exceeds 5MiB limit");
    }
    const mime = (c.req.header("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {
      return jsonError(c, "unsupported_media_type", "Unsupported content type");
    }
    const body = await c.req.raw.arrayBuffer();
    if (body.byteLength > WORKSHOP_LIMITS.projectImageUploadBytes) {
      return jsonError(c, "payload_too_large", "Gallery image exceeds 5MiB limit");
    }
    const result = await uploadGalleryImage(
      c.env.DB,
      c.env.R2,
      auth.session,
      project.id,
      Number(c.req.param("slot")),
      expectedVersion,
      body,
      mime,
    );
    if (result.kind === "conflict") {
      const latest = await getAuthoringProject(c.env.DB, project.id, auth.session);
      return versionConflict(c, "project", expectedVersion, latest?.row_version ?? project.row_version);
    }
    if (result.kind === "invalid") return jsonError(c, "bad_request", result.message);
    return c.json({ rowVersion: result.rowVersion, sha256: result.sha256, bytes: result.bytes, mime: result.mime });
  });

  authoringRoutes.delete("/:id/gallery/:slot", async (c) => {
    const auth = await sessionOrError(c);
    if (!auth.session) return auth.response;
    const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
    if (!project) return jsonError(c, "not_found", "Project not found");
    const expectedVersion = ifMatchVersion(c.req.header("if-match"));
    if (expectedVersion === null) return versionConflict(c, "project", null, project.row_version);
    const result = await deleteGalleryImage(
      c.env.DB,
      auth.session,
      project.id,
      Number(c.req.param("slot")),
      expectedVersion,
    );
    if (result.kind === "conflict") {
      const latest = await getAuthoringProject(c.env.DB, project.id, auth.session);
      return versionConflict(c, "project", expectedVersion, latest?.row_version ?? project.row_version);
    }
    if (result.kind === "invalid") return jsonError(c, "bad_request", result.message);
    return c.json(result);
  });
}
