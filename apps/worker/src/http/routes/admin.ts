import {
  adminAuditEventListQuerySchema,
  adminAuditListSchema,
  adminListQuerySchema,
  adminMemberListSchema,
  adminProjectListSchema,
  adminRecommendationUpdateSchema,
  adminReferenceSetCreateSchema,
  adminReferenceSetUpdateSchema,
  adminReferenceVersionCreateSchema,
  adminReviewRequestSchema,
  adminRoleRequestSchema,
  adminSubmissionDetailSchema,
  adminSubmissionListQuerySchema,
  submissionDiffSchema,
} from "@workshop/contracts";
import { Hono } from "hono";
import type { Env } from "../../env.js";
import { enqueueSubmission } from "../../scheduler.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";

export const adminRoutes = new Hono<{ Bindings: Env }>();

async function requireReviewer(c: Parameters<typeof requireSession>[0]) {
  const session = await requireSession(c);
  if (!session) return null;
  if (session.role !== "reviewer" && session.role !== "owner") return false;
  return session;
}

async function readJson(c: Parameters<typeof requireSession>[0]): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    return undefined;
  }
}

adminRoutes.get("/submissions", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const parsed = adminSubmissionListQuerySchema.safeParse({
    status: c.req.query("status"),
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
  });
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid query", parsed.error.flatten());
  const response = await c.executionCtx.exports.DataService.authorAdminListSubmissions(
    c.req.header("authorization"),
    parsed.data,
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "forbidden") return jsonError(c, "forbidden", "Reviewer role required");
  return c.json(response.data);
});

adminRoutes.get("/submissions/:id", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const response = await c.executionCtx.exports.DataService.authorAdminGetSubmission(
    c.req.header("authorization"),
    c.req.param("id"),
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "forbidden") return jsonError(c, "forbidden", "Reviewer role required");
  const submission = response.data;
  if (!submission) return jsonError(c, "not_found", "Submission not found");
  return c.json(adminSubmissionDetailSchema.parse(submission));
});

adminRoutes.get("/submissions/:id/files/:kind", async (c) => {
  const auth = await requireReviewer(c);
  if (!auth) return jsonError(c, auth === null ? "unauthorized" : "forbidden", "Reviewer access required");
  const kind = c.req.param("kind");
  if (kind !== "worldbook" && kind !== "regex" && kind !== "cover") {
    return jsonError(c, "bad_request", "Unsupported file kind");
  }
  return c.executionCtx.exports.DataService.fetch(c.req.raw);
});

adminRoutes.get("/submissions/:id/diff", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const response = await c.executionCtx.exports.DataService.authorAdminGetDiff(
    c.req.header("authorization"),
    c.req.param("id"),
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "forbidden") return jsonError(c, "forbidden", "Reviewer role required");
  const diff = response.data;
  if (!diff) return jsonError(c, "not_found", "Submission not found");
  return c.json(submissionDiffSchema.parse(diff));
});

adminRoutes.post("/submissions/:id/recheck", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const result = await c.executionCtx.exports.DataService.authorAdminRecheck(
    c.req.header("authorization"),
    c.req.param("id"),
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "forbidden") return jsonError(c, "forbidden", "Reviewer role required");
  if (result.kind === "not_found") return jsonError(c, "not_found", "Submission not found");
  if (result.kind === "resolved") return jsonError(c, "conflict", "Submission is already resolved");
  if (result.kind === "running") return jsonError(c, "conflict", "Checker is already running");
  try {
    c.executionCtx.waitUntil(
      enqueueSubmission(c.env, c.req.param("id")).catch((error) => {
        console.error("ContentService recheck failed", error);
      }),
    );
  } catch {
    // Direct route tests have no ExecutionContext.
  }
  return c.json({ ok: true, status: "queued" }, 202);
});

adminRoutes.post("/submissions/:id/review", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const parsed = adminReviewRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid review", parsed.error.flatten());

  const response = await c.executionCtx.exports.DataService.authorAdminReview(
    c.req.header("authorization"),
    c.req.param("id"),
    parsed.data,
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "forbidden") return jsonError(c, "forbidden", "Reviewer role required");
  const result = response.data;
  if (result.kind === "not_found") return jsonError(c, "not_found", "Submission not found");
  if (result.kind === "invalid_reason") return jsonError(c, "bad_request", "拒绝时必须填写理由");
  if (result.kind === "conflict") return jsonError(c, "conflict", "Submission has already been reviewed");
  return c.json({ id: result.id, status: result.status }, 201);
});

adminRoutes.get("/projects", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const parsed = adminListQuerySchema.safeParse({
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
    search: c.req.query("search"),
    projectType: c.req.query("projectType"),
    includeDeleted: c.req.query("includeDeleted") === "true",
  });
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid query", parsed.error.flatten());
  const result = await c.executionCtx.exports.DataService.authorAdminListProjects(
    c.req.header("authorization"),
    parsed.data.limit,
    parsed.data.cursor,
    {
      search: parsed.data.search,
      projectType: parsed.data.projectType,
      includeDeleted: parsed.data.includeDeleted,
    },
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "forbidden") return jsonError(c, "forbidden", "Reviewer role required");
  return c.json(adminProjectListSchema.parse(result.data));
});

adminRoutes.get("/members", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const parsed = adminListQuerySchema.safeParse({
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
  });
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid query", parsed.error.flatten());
  const result = await c.executionCtx.exports.DataService.authorAdminListMembers(
    c.req.header("authorization"),
    parsed.data.limit,
    parsed.data.cursor,
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "forbidden") return jsonError(c, "forbidden", "Reviewer role required");
  return c.json(adminMemberListSchema.parse(result.data));
});

adminRoutes.put("/members/:id/role", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  if (session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const parsed = adminRoleRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid role", parsed.error.flatten());

  const response = await c.executionCtx.exports.DataService.authorAdminChangeMemberRole(
    c.req.header("authorization"),
    c.req.param("id"),
    parsed.data.role,
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "forbidden") return jsonError(c, "forbidden", "Owner role required");
  const result = response.data;
  if (result.kind === "not_found") return jsonError(c, "not_found", "Member not found");
  if (result.kind === "last_owner") return jsonError(c, "conflict", "Cannot demote the last owner");
  return c.json({ ok: true });
});

adminRoutes.get("/audit-events", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const parsed = adminAuditEventListQuerySchema.safeParse({
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
    action: c.req.query("action"),
  });
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid query", parsed.error.flatten());
  const result = await c.executionCtx.exports.DataService.authorAdminListAuditEvents(
    c.req.header("authorization"),
    parsed.data.limit,
    parsed.data.cursor,
    parsed.data.action,
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "forbidden") return jsonError(c, "forbidden", "Reviewer role required");
  return c.json(adminAuditListSchema.parse(result.data));
});

adminRoutes.put("/recommendations/:projectId", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false || session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const parsed = adminRecommendationUpdateSchema.safeParse(await readJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid recommendation", parsed.error.flatten());
  const response = await c.executionCtx.exports.DataService.authorAdminUpdateRecommendation(
    c.req.header("authorization"),
    c.req.param("projectId"),
    parsed.data,
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "forbidden") return jsonError(c, "forbidden", "Owner role required");
  const result = response.data;
  if (result.kind === "not_found") return jsonError(c, "not_found", "Project not found");
  return c.json({ id: result.id, comment: result.comment, reaction: result.reaction });
});

adminRoutes.delete("/recommendations/:projectId", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false || session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const response = await c.executionCtx.exports.DataService.authorAdminDeleteRecommendation(
    c.req.header("authorization"),
    c.req.param("projectId"),
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "forbidden") return jsonError(c, "forbidden", "Owner role required");
  const result = response.data;
  if (result.kind === "not_found") return jsonError(c, "not_found", "Recommendation not found");
  return c.body(null, 204);
});

adminRoutes.post("/reference-sets", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false || session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const parsed = adminReferenceSetCreateSchema.safeParse(await readJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid reference set", parsed.error.flatten());
  const response = await c.executionCtx.exports.DataService.authorAdminCreateReferenceSet(
    c.req.header("authorization"),
    parsed.data,
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "forbidden") return jsonError(c, "forbidden", "Owner role required");
  const result = response.data;
  if (result.kind === "conflict") return jsonError(c, "conflict", "Reference set name or version already exists");
  return c.json({ id: result.id, versionId: result.versionId }, 201);
});

adminRoutes.post("/reference-sets/:id/versions", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false || session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const parsed = adminReferenceVersionCreateSchema.safeParse(await readJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid reference version", parsed.error.flatten());
  const response = await c.executionCtx.exports.DataService.authorAdminCreateReferenceVersion(
    c.req.header("authorization"),
    c.req.param("id"),
    parsed.data,
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "forbidden") return jsonError(c, "forbidden", "Owner role required");
  const result = response.data;
  if (result.kind === "not_found") return jsonError(c, "not_found", "Reference set not found");
  if (result.kind === "conflict") return jsonError(c, "conflict", "Reference version already exists");
  return c.json({ id: result.id, ordinal: result.ordinal }, 201);
});

adminRoutes.put("/reference-sets/:id", async (c) => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false || session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const parsed = adminReferenceSetUpdateSchema.safeParse(await readJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid reference set", parsed.error.flatten());
  const response = await c.executionCtx.exports.DataService.authorAdminUpdateReferenceSet(
    c.req.header("authorization"),
    c.req.param("id"),
    parsed.data,
  );
  if (response.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (response.kind === "forbidden") return jsonError(c, "forbidden", "Owner role required");
  const result = response.data;
  if (result.kind === "not_found") return jsonError(c, "not_found", "Reference set not found");
  return c.json({ ok: true });
});
