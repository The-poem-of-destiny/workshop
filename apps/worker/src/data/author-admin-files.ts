import { uploadKindSchema } from "@workshop/contracts";
import { type ProjectContentValidation, WORKSHOP_LIMITS } from "@workshop/domain";
import { Hono } from "hono";
import { jsonError, versionConflict } from "../http/errors.js";
import { ifMatchVersion } from "../http/if-match.js";
import { upsertStreamedAsset } from "../storage/authoring-assets.js";
import { getAuthoringProject } from "../storage/authoring-model.js";
import { getRevisionForProject } from "../storage/authoring-revisions.js";
import { uploadGalleryImage } from "../storage/project-gallery.js";
import { type AuthenticatedSession, getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env.js";
import { hashContentStream } from "./streaming-content.js";
import { streamImage, UploadLimitError } from "./streaming-image.js";
import { type StagedStream, stageStream } from "./streaming-staging.js";

async function persistNormalizedWorldbook(
  env: DataEnv,
  response: Response,
  projectId: string,
  revisionId: string,
  version: number,
  mime: string,
) {
  if (!response.body) throw new Error("Normalized worldbook body missing");
  const normalized = hashContentStream(response.body);
  const output = await stageStream(
    env.R2,
    normalized.body,
    WORKSHOP_LIMITS.projectUploadBytes,
    Number(response.headers.get("content-length")),
  );
  try {
    return await upsertStreamedAsset(
      env.DB,
      projectId,
      revisionId,
      version,
      "worldbook",
      await normalized.digest,
      output.bytes,
      mime,
      Number(response.headers.get("x-entry-count")),
      output.copyTo.bind(output),
    );
  } finally {
    await output.dispose().catch(() => {});
  }
}

const files = new Hono<{ Bindings: DataEnv; Variables: { session: AuthenticatedSession } }>();

files.use("*", async (c, next) => {
  const authorization = c.req.header("authorization");
  const session = authorization?.startsWith("Bearer ")
    ? await getSessionByToken(c.env.DB, authorization.slice(7), c.env.SESSION_HASH_SECRET)
    : null;
  if (!session) return jsonError(c, "unauthorized", "Login required");
  c.set("session", session);
  await next();
});

files.get("/api/v1/projects/:id/revisions/:revisionId/files/:kind", async (c) => {
  const session = c.get("session");
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const kind = uploadKindSchema.safeParse(c.req.param("kind"));
  if (!kind.success) return jsonError(c, "bad_request", "Unsupported file kind");
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const revision = await c.env.DB.prepare("SELECT id FROM project_revisions WHERE id = ? AND project_id = ?")
    .bind(c.req.param("revisionId"), project.id)
    .first<{ id: string }>();
  if (!revision) return jsonError(c, "not_found", "Revision not found");
  const asset = await c.env.DB.prepare(
    "SELECT r2_key, mime FROM assets WHERE project_id = ? AND revision_id = ? AND kind = ?",
  )
    .bind(project.id, revision.id, kind.data)
    .first<{ r2_key: string; mime: string }>();
  if (!asset) return jsonError(c, "not_found", "Asset not found");
  const object = await c.env.R2.get(asset.r2_key);
  if (!object) return jsonError(c, "not_found", "Asset not found");
  return new Response(object.body, {
    headers: { "content-type": asset.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
});

files.put("/api/v1/projects/:id/revisions/:revisionId/files/:kind", async (c) => {
  const session = c.get("session");
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const parsedKind = uploadKindSchema.safeParse(c.req.param("kind"));
  if (!parsedKind.success) return jsonError(c, "bad_request", "Unsupported file kind");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null) return jsonError(c, "precondition_failed", "If-Match is required");
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  if (expectedVersion !== project.row_version)
    return versionConflict(c, "project", expectedVersion, project.row_version);
  const revision = await getRevisionForProject(c.env.DB, project.id, c.req.param("revisionId"), session);
  if (!revision) return jsonError(c, "not_found", "Revision not found");
  const validateUpload = () => {
    const declaredLength = Number(c.req.header("content-length"));
    if (!Number.isFinite(declaredLength) || declaredLength <= 0)
      return jsonError(c, "bad_request", "Content-Length required");
    const maxBytes =
      parsedKind.data === "cover" ? WORKSHOP_LIMITS.projectImageUploadBytes : WORKSHOP_LIMITS.projectUploadBytes;
    const sizeError = parsedKind.data === "cover" ? "File exceeds 5MiB limit" : "File exceeds 10 MiB limit";
    if (declaredLength > maxBytes) return jsonError(c, "payload_too_large", sizeError);
    const mime = (c.req.header("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
    const allowedMime: Record<string, readonly string[]> = {
      worldbook: ["application/json", "text/plain"],
      regex: ["application/json", "text/plain"],
      cover: ["image/png", "image/jpeg", "image/webp"],
    };
    if (!allowedMime[parsedKind.data]?.includes(mime))
      return jsonError(c, "unsupported_media_type", "Unsupported content type");
    return { declaredLength, maxBytes, sizeError, mime };
  };
  const upload = validateUpload();
  if (upload instanceof Response) return upload;
  const { declaredLength, maxBytes, sizeError, mime } = upload;
  const uploadContent = async () => {
    if (!c.req.raw.body) return jsonError(c, "bad_request", "项目 JSON 无法解析");
    const hashed = hashContentStream(c.req.raw.body);
    let staged: StagedStream;
    try {
      staged = await stageStream(c.env.R2, hashed.body, maxBytes, declaredLength);
    } catch (error) {
      if (error instanceof RangeError && error.message === "Upload exceeds staging size")
        return jsonError(c, "payload_too_large", sizeError);
      throw error;
    }
    try {
      const id = c.env.CONTENT_SERVICE.idFromName("content-validator");
      const endpoint = parsedKind.data === "worldbook" ? "normalize-worldbook" : "validate-stream";
      const response = await c.env.CONTENT_SERVICE.get(id).fetch(
        `https://content-service/${endpoint}?kind=${parsedKind.data}`,
        { method: "POST", body: await staged.open() },
      );
      if (!response.ok) throw new Error("Content validation service unavailable");
      const count = response.headers.get("x-entry-count");
      if (parsedKind.data === "worldbook" && count !== null)
        return await persistNormalizedWorldbook(c.env, response, project.id, revision.id, expectedVersion, mime);
      const validation = (await response.json()) as ProjectContentValidation;
      if (!validation.valid) return jsonError(c, "bad_request", validation.error);
      return await upsertStreamedAsset(
        c.env.DB,
        project.id,
        revision.id,
        expectedVersion,
        parsedKind.data,
        await hashed.digest,
        staged.bytes,
        mime,
        validation.entryCount,
        staged.copyTo.bind(staged),
      );
    } finally {
      await staged.dispose().catch(() => {});
    }
  };
  const uploadCover = async () => {
    const image = streamImage(
      c.req.raw.body ??
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
      maxBytes,
    );
    let staged: StagedStream;
    try {
      staged = await stageStream(c.env.R2, image.body, maxBytes, declaredLength);
    } catch (error) {
      if (error instanceof UploadLimitError) return jsonError(c, "payload_too_large", sizeError);
      throw error;
    }
    try {
      const { sha256, dimensions } = await image.result;
      if (!dimensions || dimensions.mime !== mime)
        return jsonError(c, "bad_request", "Image format does not match content type");
      if (dimensions.width > WORKSHOP_LIMITS.coverMaxDimension || dimensions.height > WORKSHOP_LIMITS.coverMaxDimension)
        return jsonError(c, "payload_too_large", "封面尺寸不能超过 4096×4096");
      return await upsertStreamedAsset(
        c.env.DB,
        project.id,
        revision.id,
        expectedVersion,
        parsedKind.data,
        sha256,
        staged.bytes,
        mime,
        undefined,
        staged.copyTo.bind(staged),
      );
    } finally {
      await staged.dispose().catch(() => {});
    }
  };
  const result = await (parsedKind.data === "cover" ? uploadCover() : uploadContent());
  if (result instanceof Response) return result;
  if (!result) {
    const latest = await getAuthoringProject(c.env.DB, project.id, session);
    if (latest && latest.row_version !== expectedVersion)
      return versionConflict(c, "project", expectedVersion, latest.row_version);
    return jsonError(c, "conflict", "Revision is no longer editable");
  }
  return c.json(result);
});
files.put("/api/v1/projects/:id/gallery/:slot", async (c) => {
  const session = c.get("session");
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null || expectedVersion !== project.row_version)
    return versionConflict(c, "project", expectedVersion, project.row_version);
  const declaredLength = Number(c.req.header("content-length"));
  if (!Number.isFinite(declaredLength) || declaredLength <= 0)
    return jsonError(c, "bad_request", "Content-Length required");
  if (declaredLength > WORKSHOP_LIMITS.projectImageUploadBytes)
    return jsonError(c, "payload_too_large", "Gallery image exceeds 5MiB limit");
  const mime = (c.req.header("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime))
    return jsonError(c, "unsupported_media_type", "Unsupported content type");
  const image = streamImage(
    c.req.raw.body ??
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
    WORKSHOP_LIMITS.projectImageUploadBytes,
  );
  let staged: StagedStream;
  try {
    staged = await stageStream(c.env.R2, image.body, WORKSHOP_LIMITS.projectImageUploadBytes, declaredLength);
  } catch (error) {
    if (error instanceof UploadLimitError) return jsonError(c, "payload_too_large", "Gallery image exceeds 5MiB limit");
    throw error;
  }
  const result = await (async () => {
    try {
      const metadata = await image.result;
      return await uploadGalleryImage(
        c.env.DB,
        c.env.R2,
        session,
        project.id,
        Number(c.req.param("slot")),
        expectedVersion,
        {
          ...metadata,
          copyTo: staged.copyTo.bind(staged),
        },
        mime,
      );
    } finally {
      await staged.dispose().catch(() => {});
    }
  })();
  if (result.kind === "conflict") {
    const latest = await getAuthoringProject(c.env.DB, project.id, session);
    return versionConflict(c, "project", expectedVersion, latest?.row_version ?? project.row_version);
  }
  if (result.kind === "invalid") return jsonError(c, "bad_request", result.message);
  return c.json({ rowVersion: result.rowVersion, sha256: result.sha256, bytes: result.bytes, mime: result.mime });
});

export function authorAdminFilesFetch(request: Request, env: DataEnv): Promise<Response> {
  return Promise.resolve(files.fetch(request, env));
}
