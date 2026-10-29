import {
  createProjectSchema,
  patchProjectSchema,
  submitProjectSchema,
  visibilityUpdateSchema,
} from "@workshop/contracts";
import { inspectProjectMetadata, normalizeDiscordThreadUrl } from "@workshop/domain";
import type { Context } from "hono";
import { Hono } from "hono";
import type { PrevalidatedContent } from "../../data/contracts.js";
import type { Env } from "../../env";
import { enqueueSubmission } from "../../scheduler.js";
import { jsonError, versionConflict } from "../errors.js";
import { ifMatchVersion } from "../if-match.js";
import { registerAuthoringGalleryRoutes } from "./authoring-gallery.js";
import { sessionOrError } from "./authoring-request.js";

export const authoringRoutes = new Hono<{ Bindings: Env }>();

async function bodyJson(c: Context<{ Bindings: Env }>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
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
    const result = await c.executionCtx.exports.DataService.authorAdminCreateProject(
      c.req.header("authorization"),
      parsed.data,
    );
    if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    return c.json(result.data, 201);
  } catch {
    return jsonError(c, "internal", "Unable to create project");
  }
});

authoringRoutes.get("/:id/draft", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const result = await c.executionCtx.exports.DataService.authorAdminGetDraft(
    c.req.header("authorization"),
    c.req.param("id"),
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "not_found") return jsonError(c, "not_found", "Project not found");
  return c.json(result.data);
});

authoringRoutes.patch("/:id", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  const parsed = patchProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid project metadata", parsed.error.flatten());
  if (parsed.data.discordThreadUrl !== undefined) {
    const discord = normalizeThreadUrl(c, parsed.data.discordThreadUrl);
    if (!discord.ok) return jsonError(c, "bad_request", `Discord 线程地址无效：${discord.reason}`);
    parsed.data.discordThreadUrl = discord.value;
  }
  const result = await c.executionCtx.exports.DataService.authorAdminPatchProject(
    c.req.header("authorization"),
    c.req.param("id"),
    expectedVersion,
    parsed.data,
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "not_found") return jsonError(c, "not_found", "Project not found");
  if (result.kind === "version_conflict") return versionConflict(c, "project", expectedVersion, result.actual);
  if (result.kind === "cas_conflict") return versionConflict(c, "project", expectedVersion, result.actual);
  if (result.kind === "frozen")
    return jsonError(c, "conflict", "Submitted metadata is frozen; create a new revision to edit it");
  if (result.kind === "rate_limited")
    return jsonError(c, "rate_limited", "Too many metadata updates; retry in a minute");
  if (result.kind === "invalid_metadata")
    return jsonError(c, "bad_request", "Project metadata failed validation", result.findings);
  return c.json(result.data);
});
registerAuthoringGalleryRoutes(authoringRoutes);

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
  const response = await c.executionCtx.exports.DataService.authorAdminDeleteEntry(
    c.req.header("authorization"),
    c.req.param("id"),
    c.req.param("revisionId"),
    kind,
    entryKey,
    expectedVersion,
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  const result = response.data;
  if (!result) return jsonError(c, "conflict", "Entry cannot be deleted from this revision");
  return c.json(result);
});

authoringRoutes.delete("/:id", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  const result = await c.executionCtx.exports.DataService.authorAdminDeleteProject(
    c.req.header("authorization"),
    c.req.param("id"),
    expectedVersion,
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "not_found") return jsonError(c, "not_found", "Project not found");
  if (result.kind === "version_conflict") return versionConflict(c, "project", expectedVersion, result.actual);
  return c.body(null, 204);
});

authoringRoutes.patch("/:id/visibility", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  const parsed = visibilityUpdateSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid visibility", parsed.error.flatten());
  const result = await c.executionCtx.exports.DataService.authorAdminUpdateVisibility(
    c.req.header("authorization"),
    c.req.param("id"),
    expectedVersion,
    parsed.data,
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "not_found") return jsonError(c, "not_found", "Project not found");
  if (result.kind === "version_conflict") return versionConflict(c, "project", expectedVersion, result.actual);
  return c.json({ rowVersion: result.rowVersion });
});

authoringRoutes.post("/:id/revisions", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  const parsed = patchProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid revision metadata", parsed.error.flatten());
  if (parsed.data.discordThreadUrl !== undefined) {
    const discord = normalizeThreadUrl(c, parsed.data.discordThreadUrl);
    if (!discord.ok) return jsonError(c, "bad_request", `Discord 线程地址无效：${discord.reason}`);
    parsed.data.discordThreadUrl = discord.value;
  }
  const result = await c.executionCtx.exports.DataService.authorAdminCreateRevision(
    c.req.header("authorization"),
    c.req.param("id"),
    expectedVersion,
    parsed.data,
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "not_found") return jsonError(c, "not_found", "Project not found");
  if (result.kind === "version_conflict") return jsonError(c, "precondition_failed", "Project version does not match");
  if (result.kind === "cas_conflict") return versionConflict(c, "project", expectedVersion, result.actual);
  if (result.kind === "frozen")
    return jsonError(c, "conflict", "Submitted metadata is frozen; create a new revision to edit it");
  if (result.kind === "rate_limited")
    return jsonError(c, "rate_limited", "Too many metadata updates; retry in a minute");
  if (result.kind === "invalid_metadata")
    return jsonError(c, "bad_request", "Project metadata failed validation", result.findings);
  return c.json(result.data, 201);
});

authoringRoutes.get("/:id/revisions/:revisionId/files/:kind", (c) =>
  c.executionCtx.exports.DataService.fetch(c.req.raw),
);

authoringRoutes.put("/:id/revisions/:revisionId/files/:kind", (c) =>
  c.executionCtx.exports.DataService.fetch(c.req.raw),
);

authoringRoutes.post("/:id/revisions/:revisionId/submit", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null) return jsonError(c, "precondition_failed", "If-Match is required");
  const prepared = await c.executionCtx.exports.DataService.authorAdminPrepareSubmission(
    c.req.header("authorization"),
    c.req.param("id"),
    c.req.param("revisionId"),
    expectedVersion,
  );
  if (prepared.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (prepared.kind === "not_found") return jsonError(c, "not_found", prepared.message);
  if (prepared.kind === "version_conflict") return versionConflict(c, "project", expectedVersion, prepared.actual);
  if (prepared.kind === "conflict") return jsonError(c, "conflict", prepared.message);
  const parsed = submitProjectSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid submission", parsed.error.flatten());
  let prevalidated: PrevalidatedContent;
  try {
    prevalidated = await validateRevisionViaDo(c.env, c.req.param("id"), c.req.param("revisionId"));
  } catch {
    return jsonError(c, "internal", "Content validation service unavailable");
  }
  const response = await c.executionCtx.exports.DataService.authorAdminSubmit(
    c.req.header("authorization"),
    c.req.param("id"),
    c.req.param("revisionId"),
    expectedVersion,
    parsed.data,
    prevalidated,
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "not_found") return jsonError(c, "not_found", response.message);
  if (response.kind === "version_conflict") return versionConflict(c, "project", expectedVersion, response.actual);
  if (response.kind === "conflict") return jsonError(c, "conflict", response.message);
  if (response.kind === "error") {
    if (response.code === "not_found") return jsonError(c, "not_found", response.message);
    if (response.code === "conflict") return jsonError(c, "conflict", response.message);
    return jsonError(c, "bad_request", response.message);
  }
  const result = response.data;
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

authoringRoutes.post("/:id/submissions/:submissionId/withdraw", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const expectedVersion = ifMatchVersion(c.req.header("if-match"));
  if (expectedVersion === null) return jsonError(c, "precondition_failed", "If-Match is required");
  const response = await c.executionCtx.exports.DataService.authorAdminWithdraw(
    c.req.header("authorization"),
    c.req.param("id"),
    c.req.param("submissionId"),
    expectedVersion,
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "not_found") return jsonError(c, "not_found", "Project not found");
  if (response.kind === "version_conflict") return versionConflict(c, "project", expectedVersion, response.actual);
  const result = response.data;
  if (!result) return jsonError(c, "conflict", "提交已处理或项目已发生变化，请刷新后重试");
  return c.json(result);
});
