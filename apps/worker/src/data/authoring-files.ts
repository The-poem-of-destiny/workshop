import { ERROR_STATUS, type ErrorCode, uploadKindSchema } from "@workshop/contracts";
import { ifMatchVersion, type ProjectContentValidation, WORKSHOP_LIMITS } from "@workshop/domain";
import { getVersionAsset, type UploadResult, upsertStreamedAsset } from "../storage/authoring-assets.js";
import { getAuthoringProject } from "../storage/authoring-model.js";
import { getVersionForProject } from "../storage/authoring-versions.js";
import { uploadGalleryImage } from "../storage/project-gallery.js";
import { type AuthenticatedSession, getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env.js";
import { hashContentStream } from "./streaming-content.js";
import { streamImage, UploadLimitError } from "./streaming-image.js";
import { type StagedStream, stageStream } from "./streaming-staging.js";

const ALLOWED_MIME: Record<string, readonly string[]> = {
  worldbook: ["application/json", "text/plain"],
  regex: ["application/json", "text/plain"],
  cover: ["image/png", "image/jpeg", "image/webp"],
};

function errorResponse(code: ErrorCode, message: string, details?: unknown): Response {
  return Response.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status: ERROR_STATUS[code] },
  );
}

function versionConflictResponse(resource: string, expectedVersion: number | null, currentVersion: number): Response {
  return errorResponse("precondition_failed", "Resource version does not match", {
    resource,
    expectedVersion,
    currentVersion,
  });
}

function emptyBodyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

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

function decodeParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function handleGetVersionFile(
  env: DataEnv,
  session: AuthenticatedSession,
  projectId: string,
  versionId: string,
  rawKind: string,
  head: boolean,
): Promise<Response> {
  const kind = uploadKindSchema.safeParse(rawKind);
  if (!kind.success) return errorResponse("bad_request", "Unsupported file kind");
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return errorResponse("not_found", "Project not found");
  const lookup = await getVersionAsset(env.DB, project.id, versionId, kind.data);
  if (lookup.kind === "missing_revision") return errorResponse("not_found", "Revision not found");
  if (lookup.kind === "missing_asset") return errorResponse("not_found", "Asset not found");
  const object = await env.R2.get(lookup.r2_key);
  if (!object) return errorResponse("not_found", "Asset not found");
  const headers = {
    "content-type": lookup.mime,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  if (head) {
    await object.body.cancel().catch(() => {});
    return new Response(null, { headers });
  }
  return new Response(object.body, { headers });
}

async function stageValidatedContentUpload(
  request: Request,
  env: DataEnv,
  projectId: string,
  revisionId: string,
  expectedVersion: number,
  kind: "worldbook" | "regex",
  declaredLength: number,
  maxBytes: number,
  sizeError: string,
  mime: string,
): Promise<UploadResult | Response | null> {
  if (!request.body) return errorResponse("bad_request", "项目 JSON 无法解析");
  const hashed = hashContentStream(request.body);
  let staged: StagedStream;
  try {
    staged = await stageStream(env.R2, hashed.body, maxBytes, declaredLength);
  } catch (error) {
    if (error instanceof RangeError && error.message === "Upload exceeds staging size")
      return errorResponse("payload_too_large", sizeError);
    throw error;
  }
  try {
    const id = env.CONTENT_SERVICE.idFromName("content-validator");
    const endpoint = kind === "worldbook" ? "normalize-worldbook" : "validate-stream";
    const response = await env.CONTENT_SERVICE.get(id).fetch(`https://content-service/${endpoint}?kind=${kind}`, {
      method: "POST",
      body: await staged.open(),
    });
    if (!response.ok) throw new Error("Content validation service unavailable");
    const count = response.headers.get("x-entry-count");
    if (kind === "worldbook" && count !== null) {
      return await persistNormalizedWorldbook(env, response, projectId, revisionId, expectedVersion, mime);
    }
    const validation = (await response.json()) as ProjectContentValidation;
    if (!validation.valid) return errorResponse("bad_request", validation.error);
    return await upsertStreamedAsset(
      env.DB,
      projectId,
      revisionId,
      expectedVersion,
      kind,
      await hashed.digest,
      staged.bytes,
      mime,
      validation.entryCount,
      staged.copyTo.bind(staged),
    );
  } finally {
    await staged.dispose().catch(() => {});
  }
}

async function stageCoverUpload(
  request: Request,
  env: DataEnv,
  projectId: string,
  revisionId: string,
  expectedVersion: number,
  declaredLength: number,
  maxBytes: number,
  sizeError: string,
  mime: string,
): Promise<UploadResult | Response | null> {
  const image = streamImage(request.body ?? emptyBodyStream(), maxBytes);
  let staged: StagedStream;
  try {
    staged = await stageStream(env.R2, image.body, maxBytes, declaredLength);
  } catch (error) {
    if (
      error instanceof UploadLimitError ||
      (error instanceof RangeError && error.message === "Upload exceeds staging size")
    )
      return errorResponse("payload_too_large", sizeError);
    throw error;
  }
  try {
    const { sha256, dimensions } = await image.result;
    if (!dimensions || dimensions.mime !== mime)
      return errorResponse("bad_request", "Image format does not match content type");
    if (dimensions.width > WORKSHOP_LIMITS.coverMaxDimension || dimensions.height > WORKSHOP_LIMITS.coverMaxDimension)
      return errorResponse("payload_too_large", "封面尺寸不能超过 4096×4096");
    return await upsertStreamedAsset(
      env.DB,
      projectId,
      revisionId,
      expectedVersion,
      "cover",
      sha256,
      staged.bytes,
      mime,
      undefined,
      staged.copyTo.bind(staged),
    );
  } finally {
    await staged.dispose().catch(() => {});
  }
}

async function handlePutVersionFile(
  request: Request,
  env: DataEnv,
  session: AuthenticatedSession,
  projectId: string,
  versionId: string,
  rawKind: string,
): Promise<Response> {
  const parsedKind = uploadKindSchema.safeParse(rawKind);
  if (!parsedKind.success) return errorResponse("bad_request", "Unsupported file kind");
  const expectedVersion = ifMatchVersion(request.headers.get("if-match"));
  if (expectedVersion === null) return errorResponse("precondition_failed", "If-Match is required");
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return errorResponse("not_found", "Project not found");
  if (expectedVersion !== project.row_version)
    return versionConflictResponse("project", expectedVersion, project.row_version);
  const revision = await getVersionForProject(env.DB, project.id, versionId, session);
  if (!revision) return errorResponse("not_found", "Revision not found");

  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declaredLength) || declaredLength <= 0)
    return errorResponse("bad_request", "Content-Length required");
  const maxBytes =
    parsedKind.data === "cover" ? WORKSHOP_LIMITS.projectImageUploadBytes : WORKSHOP_LIMITS.projectUploadBytes;
  const sizeError = parsedKind.data === "cover" ? "File exceeds 1MiB limit" : "File exceeds 10 MiB limit";
  if (declaredLength > maxBytes) return errorResponse("payload_too_large", sizeError);
  const mime = (request.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (!ALLOWED_MIME[parsedKind.data]?.includes(mime))
    return errorResponse("unsupported_media_type", "Unsupported content type");

  const result =
    parsedKind.data === "cover"
      ? await stageCoverUpload(
          request,
          env,
          project.id,
          revision.id,
          expectedVersion,
          declaredLength,
          maxBytes,
          sizeError,
          mime,
        )
      : await stageValidatedContentUpload(
          request,
          env,
          project.id,
          revision.id,
          expectedVersion,
          parsedKind.data,
          declaredLength,
          maxBytes,
          sizeError,
          mime,
        );
  if (result instanceof Response) return result;
  if (!result) {
    const latest = await getAuthoringProject(env.DB, project.id, session);
    if (latest && latest.row_version !== expectedVersion)
      return versionConflictResponse("project", expectedVersion, latest.row_version);
    return errorResponse("conflict", "Revision is no longer editable");
  }
  return Response.json(result);
}

async function handlePutGalleryImage(
  request: Request,
  env: DataEnv,
  session: AuthenticatedSession,
  projectId: string,
  rawSlot: string,
): Promise<Response> {
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return errorResponse("not_found", "Project not found");
  const expectedVersion = ifMatchVersion(request.headers.get("if-match"));
  if (expectedVersion === null || expectedVersion !== project.row_version)
    return versionConflictResponse("project", expectedVersion, project.row_version);
  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declaredLength) || declaredLength <= 0)
    return errorResponse("bad_request", "Content-Length required");
  if (declaredLength > WORKSHOP_LIMITS.projectImageUploadBytes)
    return errorResponse("payload_too_large", "Gallery image exceeds 1MiB limit");
  const mime = (request.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (!ALLOWED_MIME.cover!.includes(mime)) return errorResponse("unsupported_media_type", "Unsupported content type");

  const image = streamImage(request.body ?? emptyBodyStream(), WORKSHOP_LIMITS.projectImageUploadBytes);
  let staged: StagedStream;
  try {
    staged = await stageStream(env.R2, image.body, WORKSHOP_LIMITS.projectImageUploadBytes, declaredLength);
  } catch (error) {
    if (
      error instanceof UploadLimitError ||
      (error instanceof RangeError && error.message === "Upload exceeds staging size")
    )
      return errorResponse("payload_too_large", "Gallery image exceeds 1MiB limit");
    throw error;
  }
  let result: Awaited<ReturnType<typeof uploadGalleryImage>>;
  try {
    const metadata = await image.result;
    result = await uploadGalleryImage(
      env.DB,
      session,
      project.id,
      Number(rawSlot),
      expectedVersion,
      { ...metadata, copyTo: staged.copyTo.bind(staged) },
      mime,
    );
  } finally {
    await staged.dispose().catch(() => {});
  }
  if (result.kind === "conflict") {
    const latest = await getAuthoringProject(env.DB, project.id, session);
    return versionConflictResponse("project", expectedVersion, latest?.row_version ?? project.row_version);
  }
  if (result.kind === "invalid") return errorResponse("bad_request", result.message);
  return Response.json({
    rowVersion: result.rowVersion,
    sha256: result.sha256,
    bytes: result.bytes,
    mime: result.mime,
  });
}

export async function authoringFilesFetch(request: Request, env: DataEnv): Promise<Response> {
  const authorization = request.headers.get("authorization");
  const session = authorization?.startsWith("Bearer ")
    ? await getSessionByToken(env.DB, authorization.slice(7), env.SESSION_HASH_SECRET)
    : null;
  if (!session) return errorResponse("unauthorized", "Login required");
  if (!session.policyAccepted) return errorResponse("forbidden", "请先阅读并同意工坊使用政策并完成准入问答");

  const { pathname } = new URL(request.url);
  const versionMatch = /^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/files\/([^/]+)$/.exec(pathname);
  if (versionMatch) {
    const projectId = decodeParam(versionMatch[1]!);
    const versionId = decodeParam(versionMatch[2]!);
    const kind = decodeParam(versionMatch[3]!);
    if (request.method === "GET" || request.method === "HEAD") {
      return handleGetVersionFile(env, session, projectId, versionId, kind, request.method === "HEAD");
    }
    if (request.method === "PUT") return handlePutVersionFile(request, env, session, projectId, versionId, kind);
  }
  const galleryMatch = /^\/api\/v1\/projects\/([^/]+)\/gallery\/([^/]+)$/.exec(pathname);
  if (galleryMatch && request.method === "PUT") {
    return handlePutGalleryImage(request, env, session, decodeParam(galleryMatch[1]!), decodeParam(galleryMatch[2]!));
  }
  return errorResponse("not_found", "Not found");
}
