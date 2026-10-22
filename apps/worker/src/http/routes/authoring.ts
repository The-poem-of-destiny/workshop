import {
  createProjectSchema,
  patchProjectSchema,
  submitProjectSchema,
  uploadKindSchema,
  visibilityUpdateSchema,
} from "@workshop/contracts";
import {
  detectImageDimensions,
  inspectProjectMetadata,
  normalizeDiscordThreadUrl,
  type ProjectContentValidation,
  type ProjectEntryKind,
  WORKSHOP_LIMITS,
} from "@workshop/domain";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Env } from "../../env";
import { enqueueSubmission } from "../../scheduler.js";
import {
  createProject,
  createRevision,
  deleteProjectEntry,
  getAuthoringProject,
  getProjectSummary,
  getRevisionForProject,
  type PrevalidatedContent,
  patchProject,
  softDeleteProject,
  submitRevision,
  updateVisibility,
  upsertAsset,
} from "../../storage/authoring.js";
import {
  getPublishedMetadata,
  updatePublishedCover,
  updatePublishedMetadata,
} from "../../storage/published-display.js";
import { jsonError, versionConflict } from "../errors.js";
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

async function validateContentViaDo(env: Env, text: string, kind: ProjectEntryKind): Promise<ProjectContentValidation> {
  const id = env.CONTENT_SERVICE.idFromName("content-validator");
  const response = await env.CONTENT_SERVICE.get(id).fetch("https://content-service/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ validate: { kind, text } }),
  });
  if (!response.ok) throw new Error("Content validation service unavailable");
  return response.json() as Promise<ProjectContentValidation>;
}

async function validateRevisionViaDo(env: Env, projectId: string, revisionId: string): Promise<PrevalidatedContent> {
  const id = env.CONTENT_SERVICE.idFromName("content-validator");
  const response = await env.CONTENT_SERVICE.get(id).fetch("https://content-service/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ validateRevision: revisionId, projectId }),
  });
  if (!response.ok) throw new Error("Content validation service unavailable");
  return response.json() as Promise<PrevalidatedContent>;
}

async function metadataRateLimited(db: D1Database, projectId: string, actorId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const row = await db
    .prepare(`
    SELECT
      (SELECT COUNT(*) FROM audit_events
        WHERE target_id = ? AND actor_id = ?
          AND action IN ('project.patch', 'project.published_metadata.patch', 'project.published_cover.put')
          AND created_at > ?)
      + (SELECT COUNT(*) FROM project_revisions
        WHERE project_id = ? AND created_by = ? AND created_at > ?) AS total
  `)
    .bind(projectId, actorId, cutoff, projectId, actorId, cutoff)
    .first<{ total: number }>();
  return (row?.total ?? 0) >= 20;
}

async function sessionOrError(c: Context<{ Bindings: Env }>) {
  const session = await requireSession(c);
  if (!session) return { response: jsonError(c, "unauthorized", "Login required") };
  return { session };
}

function allowedGuildIds(c: Context<{ Bindings: Env }>): string[] {
  return (c.env.DISCORD_ALLOWED_GUILD_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeThreadUrl(
  c: Context<{ Bindings: Env }>,
  value: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; reason: string } {
  return normalizeDiscordThreadUrl(value, allowedGuildIds(c));
}

authoringRoutes.post("/", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const parsed = createProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid project metadata", parsed.error.flatten());
  const discord = normalizeThreadUrl(c, parsed.data.discordThreadUrl);
  if (!discord.ok) return jsonError(c, "bad_request", `Discord 线程地址无效：${discord.reason}`);
  parsed.data.discordThreadUrl = discord.value;
  const metadata = inspectProjectMetadata(parsed.data);
  if (metadata.gate === "block") {
    return jsonError(c, "bad_request", "Project metadata failed validation", metadata.findings);
  }
  try {
    return c.json(await createProject(c.env.DB, auth.session, parsed.data), 201);
  } catch {
    return jsonError(c, "internal", "Unable to create project");
  }
});

authoringRoutes.get("/:id/draft", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const summary = await getProjectSummary(c.env.DB, project.id);
  if (!summary) return jsonError(c, "not_found", "Project not found");
  const latestSubmission = await c.env.DB.prepare(`
    SELECT s.id, s.revision_id, s.status, s.check_status, s.resolved_at,
      r.decision, r.reason
    FROM submissions s LEFT JOIN reviews r ON r.submission_id = s.id
    WHERE s.project_id = ?
    ORDER BY s.submitted_at DESC LIMIT 1
  `)
    .bind(project.id)
    .first<{
      id: string;
      revision_id: string;
      status: string;
      check_status: string;
      resolved_at: string | null;
      decision: string | null;
      reason: string | null;
    }>();
  return c.json({
    project: summary,
    rowVersion: project.row_version,
    workingRevisionId: project.working_revision_id,
    latestSubmission: latestSubmission ?? null,
  });
});

authoringRoutes.patch("/:id", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null || expectedVersion !== project.row_version) {
    return versionConflict(c, "project", expectedVersion, project.row_version);
  }
  if (project.working_revision_frozen) {
    return jsonError(c, "conflict", "Submitted metadata is frozen; create a new revision to edit it");
  }
  if (await metadataRateLimited(c.env.DB, project.id, auth.session.userId)) {
    return jsonError(c, "rate_limited", "Too many metadata updates; retry in a minute");
  }
  const parsed = patchProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid project metadata", parsed.error.flatten());
  if (parsed.data.discordThreadUrl !== undefined) {
    const discord = normalizeThreadUrl(c, parsed.data.discordThreadUrl);
    if (!discord.ok) return jsonError(c, "bad_request", `Discord 线程地址无效：${discord.reason}`);
    parsed.data.discordThreadUrl = discord.value;
  }
  const metadata = inspectProjectMetadata({
    title: parsed.data.title ?? project.title,
    description: parsed.data.description !== undefined ? parsed.data.description : project.description,
    authorNote: parsed.data.authorNote !== undefined ? parsed.data.authorNote : project.author_note,
    precautions: parsed.data.precautions !== undefined ? parsed.data.precautions : project.precautions,
    versionLabel: parsed.data.versionLabel !== undefined ? parsed.data.versionLabel : project.version_label,
    tags: parsed.data.tags,
    coverPositionX: parsed.data.coverPositionX ?? project.cover_position_x,
    coverPositionY: parsed.data.coverPositionY ?? project.cover_position_y,
    coverZoom: parsed.data.coverZoom ?? project.cover_zoom,
  });
  if (metadata.gate === "block") {
    return jsonError(c, "bad_request", "Project metadata failed validation", metadata.findings);
  }
  const result = await patchProject(c.env.DB, auth.session, project.id, expectedVersion, parsed.data);
  if (!result) return versionConflict(c, "project", expectedVersion, project.row_version);
  return c.json(result);
});
authoringRoutes.get("/:id/published-metadata", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project || !project.published_revision_id) return jsonError(c, "not_found", "Published project not found");
  const metadata = await getPublishedMetadata(c.env.DB, project.id, auth.session);
  if (!metadata) return jsonError(c, "not_found", "Published project not found");
  return c.json({ rowVersion: project.row_version, ...metadata });
});

authoringRoutes.get("/:id/published-cover", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project || !project.published_revision_id) return jsonError(c, "not_found", "Published cover not found");
  const asset = await c.env.DB.prepare(`
    SELECT COALESCE(
      (
        SELECT a.r2_key FROM assets a
        WHERE a.id = p.published_cover_asset_id AND a.project_id = p.id
          AND a.revision_id IS NULL AND a.kind = 'cover'
      ),
      (
        SELECT a.r2_key FROM assets a
        WHERE a.revision_id = p.published_revision_id AND a.kind = 'cover' LIMIT 1
      )
    ) AS r2_key
    FROM projects p WHERE p.id = ? AND p.deleted_at IS NULL
  `)
    .bind(project.id)
    .first<{ r2_key: string | null }>();
  if (!asset?.r2_key) return jsonError(c, "not_found", "Published cover not found");
  const object = await c.env.R2.get(asset.r2_key);
  if (!object) return jsonError(c, "not_found", "Published cover not found");
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "content-length": String(object.size),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

authoringRoutes.patch("/:id/published-metadata", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null || expectedVersion !== project.row_version) {
    return versionConflict(c, "project", expectedVersion, project.row_version);
  }
  if (await metadataRateLimited(c.env.DB, project.id, auth.session.userId)) {
    return jsonError(c, "rate_limited", "Too many metadata updates; retry in a minute");
  }
  const parsed = patchProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid project metadata", parsed.error.flatten());
  if (parsed.data.discordThreadUrl !== undefined) {
    const discord = normalizeThreadUrl(c, parsed.data.discordThreadUrl);
    if (!discord.ok) return jsonError(c, "bad_request", `Discord 线程地址无效：${discord.reason}`);
    parsed.data.discordThreadUrl = discord.value;
  }
  const result = await updatePublishedMetadata(c.env.DB, auth.session, project.id, expectedVersion, parsed.data);
  if (result.kind === "conflict") {
    const latest = await getAuthoringProject(c.env.DB, project.id, auth.session);
    return versionConflict(c, "project", expectedVersion, latest?.row_version ?? project.row_version);
  }
  if (result.kind === "invalid") {
    return jsonError(c, "bad_request", "Project metadata failed validation", result.findings);
  }
  return c.json({ rowVersion: result.rowVersion });
});

authoringRoutes.put("/:id/published-cover", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null || expectedVersion !== project.row_version) {
    return versionConflict(c, "project", expectedVersion, project.row_version);
  }
  if (await metadataRateLimited(c.env.DB, project.id, auth.session.userId)) {
    return jsonError(c, "rate_limited", "Too many metadata updates; retry in a minute");
  }
  const declaredLength = Number(c.req.header("content-length"));
  if (!Number.isFinite(declaredLength) || declaredLength <= 0) {
    return jsonError(c, "bad_request", "Content-Length required");
  }
  if (declaredLength > MAX_UPLOAD_BYTES) {
    return jsonError(c, "payload_too_large", "File exceeds 10 MiB limit");
  }
  const mime = (c.req.header("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    return jsonError(c, "unsupported_media_type", "Unsupported content type");
  }
  const body = await c.req.raw.arrayBuffer();
  if (body.byteLength > MAX_UPLOAD_BYTES) return jsonError(c, "payload_too_large", "File exceeds 10 MiB limit");
  const result = await updatePublishedCover(c.env.DB, c.env.R2, auth.session, project.id, expectedVersion, body, mime);
  if (result.kind === "conflict") {
    const latest = await getAuthoringProject(c.env.DB, project.id, auth.session);
    return versionConflict(c, "project", expectedVersion, latest?.row_version ?? project.row_version);
  }
  if (result.kind === "invalid") return jsonError(c, "bad_request", result.message);
  return c.json({ rowVersion: result.rowVersion, sha256: result.sha256, bytes: result.bytes, mime: result.mime });
});

authoringRoutes.delete("/:id/revisions/:revisionId/entries/:kind/:entryKey", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const kind = c.req.param("kind");
  if (kind !== "worldbook" && kind !== "regex") return jsonError(c, "bad_request", "Unknown file kind");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null) return jsonError(c, "precondition_failed", "If-Match is required");
  let entryKey: string;
  try {
    entryKey = decodeURIComponent(c.req.param("entryKey"));
  } catch {
    return jsonError(c, "bad_request", "Invalid entry key");
  }
  const result = await deleteProjectEntry(
    c.env.DB,
    c.env.R2,
    auth.session,
    c.req.param("id"),
    c.req.param("revisionId"),
    kind,
    entryKey,
    expectedVersion,
  );
  if (!result) return jsonError(c, "conflict", "Entry cannot be deleted from this revision");
  return c.json(result);
});

authoringRoutes.delete("/:id", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null) return versionConflict(c, "project", null, project.row_version);
  if (expectedVersion !== project.row_version) {
    return versionConflict(c, "project", expectedVersion, project.row_version);
  }
  const deleted = await softDeleteProject(c.env.DB, auth.session, project.id, expectedVersion);
  if (!deleted) return versionConflict(c, "project", expectedVersion, project.row_version);
  return c.body(null, 204);
});

authoringRoutes.patch("/:id/visibility", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null || expectedVersion !== project.row_version) {
    return versionConflict(c, "project", expectedVersion, project.row_version);
  }
  const parsed = visibilityUpdateSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid visibility", parsed.error.flatten());
  const rowVersion = await updateVisibility(c.env.DB, auth.session, project.id, expectedVersion, parsed.data);
  if (!rowVersion) return versionConflict(c, "project", expectedVersion, project.row_version);
  return c.json({ rowVersion });
});

authoringRoutes.post("/:id/revisions", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null || expectedVersion !== project.row_version) {
    return jsonError(c, "precondition_failed", "Project version does not match");
  }
  if (await metadataRateLimited(c.env.DB, project.id, auth.session.userId)) {
    return jsonError(c, "rate_limited", "Too many metadata updates; retry in a minute");
  }
  const parsed = patchProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid revision metadata", parsed.error.flatten());
  if (parsed.data.discordThreadUrl !== undefined) {
    const discord = normalizeThreadUrl(c, parsed.data.discordThreadUrl);
    if (!discord.ok) return jsonError(c, "bad_request", `Discord 线程地址无效：${discord.reason}`);
    parsed.data.discordThreadUrl = discord.value;
  }
  const metadata = inspectProjectMetadata({
    title: parsed.data.title ?? project.title,
    description: parsed.data.description !== undefined ? parsed.data.description : project.description,
    authorNote: parsed.data.authorNote !== undefined ? parsed.data.authorNote : project.author_note,
    precautions: parsed.data.precautions !== undefined ? parsed.data.precautions : project.precautions,
    versionLabel: parsed.data.versionLabel !== undefined ? parsed.data.versionLabel : project.version_label,
    tags: parsed.data.tags,
    coverPositionX: parsed.data.coverPositionX ?? project.cover_position_x,
    coverPositionY: parsed.data.coverPositionY ?? project.cover_position_y,
    coverZoom: parsed.data.coverZoom ?? project.cover_zoom,
  });
  if (metadata.gate === "block") {
    return jsonError(c, "bad_request", "Project metadata failed validation", metadata.findings);
  }
  const result = await createRevision(c.env.DB, auth.session, project.id, expectedVersion, parsed.data);
  if (!result) return versionConflict(c, "project", expectedVersion, project.row_version);
  return c.json(result, 201);
});

authoringRoutes.get("/:id/revisions/:revisionId/files/cover", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  const asset = await c.env.DB.prepare(`
    SELECT r2_key, mime FROM assets
    WHERE project_id = ? AND revision_id = ? AND kind = 'cover'
  `)
    .bind(c.req.param("id"), c.req.param("revisionId"))
    .first<{ r2_key: string; mime: string }>();
  if (!asset) return jsonError(c, "not_found", "Cover not found");
  const object = await c.env.R2.get(asset.r2_key);
  if (!object) return jsonError(c, "not_found", "Cover not found");
  return new Response(object.body, {
    headers: {
      "content-type": asset.mime,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

authoringRoutes.put("/:id/revisions/:revisionId/files/:kind", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const parsedKind = uploadKindSchema.safeParse(c.req.param("kind"));
  if (!parsedKind.success) return jsonError(c, "bad_request", "Unsupported file kind");
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null) return jsonError(c, "precondition_failed", "If-Match is required");
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  if (expectedVersion !== project.row_version) {
    return versionConflict(c, "project", expectedVersion, project.row_version);
  }
  const revision = await getRevisionForProject(c.env.DB, project.id, c.req.param("revisionId"), auth.session);
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
  let entryCount: number | undefined;
  if (parsedKind.data !== "cover") {
    const validation = await validateContentViaDo(c.env, new TextDecoder().decode(body), parsedKind.data);
    if (!validation.valid) return jsonError(c, "bad_request", validation.error);
    entryCount = validation.entryCount;
  } else {
    const dimensions = detectImageDimensions(new Uint8Array(body));
    if (!dimensions) return jsonError(c, "bad_request", "无法识别封面图片尺寸");
    if (dimensions.width > WORKSHOP_LIMITS.coverMaxDimension || dimensions.height > WORKSHOP_LIMITS.coverMaxDimension) {
      return jsonError(c, "payload_too_large", "封面尺寸不能超过 4096×4096");
    }
  }
  const result = await upsertAsset(
    c.env.DB,
    c.env.R2,
    project.id,
    revision.id,
    expectedVersion,
    parsedKind.data,
    body,
    mime,
    entryCount,
  );
  if (!result) {
    const latest = await getAuthoringProject(c.env.DB, project.id, auth.session);
    if (latest && latest.row_version !== expectedVersion) {
      return versionConflict(c, "project", expectedVersion, latest.row_version);
    }
    return jsonError(c, "conflict", "Revision is no longer editable");
  }
  return c.json(result);
});

authoringRoutes.post("/:id/revisions/:revisionId/submit", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null) return jsonError(c, "precondition_failed", "If-Match is required");
  const project = await getAuthoringProject(c.env.DB, c.req.param("id"), auth.session);
  if (!project) return jsonError(c, "not_found", "Project not found");
  if (expectedVersion !== project.row_version) {
    return versionConflict(c, "project", expectedVersion, project.row_version);
  }
  if (project.working_revision_id !== c.req.param("revisionId")) {
    return jsonError(c, "not_found", "Working revision not found");
  }
  if (project.working_revision_frozen) {
    return jsonError(c, "conflict", "Revision is already submitted; create a new revision");
  }
  const parsed = submitProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid submission", parsed.error.flatten());
  let prevalidated: PrevalidatedContent;
  try {
    prevalidated = await validateRevisionViaDo(c.env, project.id, c.req.param("revisionId"));
  } catch {
    return jsonError(c, "internal", "Content validation service unavailable");
  }
  const result = await submitRevision(
    c.env.DB,
    auth.session,
    project.id,
    c.req.param("revisionId"),
    expectedVersion,
    project.published_revision_id,
    parsed.data,
    prevalidated,
  );
  if (!result.ok) {
    if (result.code === "not_found") return jsonError(c, "not_found", result.message);
    if (result.code === "conflict") {
      const latest = await getAuthoringProject(c.env.DB, project.id, auth.session);
      if (latest && latest.row_version !== expectedVersion) {
        return versionConflict(c, "project", expectedVersion, latest.row_version);
      }
      return jsonError(c, "conflict", result.message);
    }
    return jsonError(c, "bad_request", result.message);
  }
  if (result.checkStatus === "queued") {
    try {
      c.executionCtx.waitUntil(
        enqueueSubmission(c.env, result.submissionId).catch((error) => {
          console.error("ContentService run failed", error);
        }),
      );
    } catch (error) {
      // Direct route tests have no ExecutionContext; production always does.
      console.error("ContentService enqueue failed", error);
    }
  }
  return c.json(
    {
      submissionId: result.submissionId,
      status: result.status,
      checkStatus: result.checkStatus,
      rowVersion: result.rowVersion,
    },
    201,
  );
});
