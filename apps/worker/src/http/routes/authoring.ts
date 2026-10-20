import { WORKSHOP_LIMITS } from "@workshop/domain";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  createProjectSchema,
  patchProjectSchema,
  submitProjectSchema,
  uploadKindSchema,
  visibilityUpdateSchema,
} from "@workshop/contracts";
import type { Env } from "../../env";
import {
  createProject,
  createRevision,
  getAuthoringProject,
  getProjectSummary,
  getRevisionForProject,
  patchProject,
  submitRevision,
  updateVisibility,
  upsertAsset,
} from "../../storage/authoring.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";

export const authoringRoutes = new Hono<{ Bindings: Env }>();
const MAX_UPLOAD_BYTES = WORKSHOP_LIMITS.projectUploadBytes;

async function bodyJson(c: Context<{ Bindings: Env }>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function ifMatchVersion(value: string | undefined): number | null {
  if (!value) return null;
  const unquoted = value.trim().replace(/^"|"$|^'|'$/g, "");
  const parsed = Number(unquoted);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function sessionOrError(c: Context<{ Bindings: Env }>) {
  const session = await requireSession(c);
  if (!session) return { response: jsonError(c, "unauthorized", "Login required") };
  return { session };
}

authoringRoutes.post("/", async c => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const parsed = createProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid project metadata", parsed.error.flatten());
  try {
    return c.json(await createProject(c.env.DB, auth.session, parsed.data), 201);
  } catch {
    return jsonError(c, "internal", "Unable to create project");
  }
});

authoringRoutes.get("/:id/draft", async c => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const summary = await getProjectSummary(c.env.DB, project.id);
  if (!summary) return jsonError(c, "not_found", "Project not found");
  return c.json({
    project: summary,
    rowVersion: project.row_version,
    workingRevisionId: project.working_revision_id,
  });
});

authoringRoutes.patch("/:id", async c => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null || expectedVersion !== project.row_version) {
    return jsonError(c, "precondition_failed", "Project version does not match");
  }
  const parsed = patchProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid project metadata", parsed.error.flatten());
  const result = await patchProject(c.env.DB, auth.session, project.id, expectedVersion, parsed.data);
  if (!result) return jsonError(c, "precondition_failed", "Project version does not match");
  return c.json(result);
});

authoringRoutes.patch("/:id/visibility", async c => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null || expectedVersion !== project.row_version) {
    return jsonError(c, "precondition_failed", "Project version does not match");
  }
  const parsed = visibilityUpdateSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid visibility", parsed.error.flatten());
  const rowVersion = await updateVisibility(c.env.DB, auth.session, project.id, expectedVersion, parsed.data);
  if (!rowVersion) return jsonError(c, "precondition_failed", "Project version does not match");
  return c.json({ rowVersion });
});

authoringRoutes.post("/:id/revisions", async c => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null || expectedVersion !== project.row_version) {
    return jsonError(c, "precondition_failed", "Project version does not match");
  }
  const parsed = patchProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid revision metadata", parsed.error.flatten());
  const result = await createRevision(c.env.DB, auth.session, project.id, expectedVersion, parsed.data);
  if (!result) return jsonError(c, "precondition_failed", "Project version does not match");
  return c.json(result, 201);
});

authoringRoutes.put("/:id/revisions/:revisionId/files/:kind", async c => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const parsedKind = uploadKindSchema.safeParse(c.req.param("kind"));
  if (!parsedKind.success) return jsonError(c, "bad_request", "Unsupported file kind");
  const revision = await getRevisionForProject(c.env.DB, c.req.param("id"), c.req.param("revisionId"), auth.session);
  if (!revision) return jsonError(c, "not_found", "Revision not found");
  const declaredLength = Number(c.req.header("content-length"));
  if (!Number.isFinite(declaredLength) || declaredLength <= 0) {
    return jsonError(c, "bad_request", "Content-Length required");
  }
  if (declaredLength > MAX_UPLOAD_BYTES) {
    return jsonError(c, "payload_too_large", "File exceeds 10 MiB limit");
  }
  const mime = (c.req.header("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  const allowedMime: Record<string, readonly string[]> = {
    worldbook: ["application/json", "text/plain"],
    regex: ["application/json", "text/plain"],
    cover: ["image/png", "image/jpeg", "image/webp"],
  };
  if (!allowedMime[parsedKind.data]?.includes(mime)) {
    return jsonError(c, "unsupported_media_type", "Unsupported content type");
  }
  const body = await c.req.raw.arrayBuffer();
  if (body.byteLength > MAX_UPLOAD_BYTES) return jsonError(c, "payload_too_large", "File exceeds 10 MiB limit");
  const result = await upsertAsset(c.env.DB, c.env.R2, c.req.param("id"), revision.id, parsedKind.data, body, mime);
  if (!result) return jsonError(c, "conflict", "Revision is no longer editable");
  return c.json(result);
});

authoringRoutes.post("/:id/revisions/:revisionId/submit", async c => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const parsed = submitProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid submission", parsed.error.flatten());
  const submissionId = await submitRevision(c.env.DB, auth.session, c.req.param("id"), c.req.param("revisionId"), parsed.data);
  if (!submissionId) return jsonError(c, "not_found", "Working revision not found");
  return c.json({ submissionId, status: "pending" }, 201);
});
