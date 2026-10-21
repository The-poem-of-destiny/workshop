import { Hono } from "hono";
import {
  adminAuditEventListQuerySchema,
  adminListQuerySchema,
  adminRecommendationUpdateSchema,
  adminReferenceSetUpdateSchema,
  adminReviewRequestSchema,
  adminRoleRequestSchema,
  adminSiteUpdateSchema,
  adminSubmissionListQuerySchema,
} from "@workshop/contracts";
import type { Env } from "../../env.js";
import { enqueueSubmission } from "../../scheduler.js";
import {
  changeAdminMemberRole,
  deleteAdminRecommendation,
  getAdminSubmission,
  getSubmissionAsset,
  listAdminAuditEvents,
  listAdminMembers,
  listAdminProjects,
  listAdminSubmissions,
  reviewAdminSubmission,
  updateAdminRecommendation,
  updateAdminReferenceSet,
  updateAdminSite,
} from "../../storage/admin.js";
import { getSubmissionDiff } from "../../storage/diff.js";
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

adminRoutes.get("/submissions", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const parsed = adminSubmissionListQuerySchema.safeParse({
    status: c.req.query("status"),
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
  });
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid query", parsed.error.flatten());
  return c.json(await listAdminSubmissions(c.env.DB, parsed.data));
});

adminRoutes.get("/submissions/:id", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const submission = await getAdminSubmission(c.env.DB, c.req.param("id"));
  if (!submission) return jsonError(c, "not_found", "Submission not found");
  return c.json(submission);
});

adminRoutes.get("/submissions/:id/files/:kind", async c => {
  const auth = await requireReviewer(c);
  if (!auth) return jsonError(c, auth === null ? "unauthorized" : "forbidden", "Reviewer access required");
  const kind = c.req.param("kind");
  if (kind !== "worldbook" && kind !== "regex" && kind !== "cover") {
    return jsonError(c, "bad_request", "Unsupported file kind");
  }
  const asset = await getSubmissionAsset(c.env.DB, c.req.param("id"), kind);
  if (!asset) return jsonError(c, "not_found", "File not found");
  const object = await c.env.R2.get(asset.r2_key);
  if (!object) return jsonError(c, "not_found", "File not found");
  return new Response(object.body, {
    headers: {
      "content-type": asset.mime,
      "content-length": String(asset.bytes),
      "cache-control": "private, no-store",
    },
  });
});

adminRoutes.get("/submissions/:id/diff", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const diff = await getSubmissionDiff(c.env.DB, c.env.R2, c.req.param("id"));
  if (!diff) return jsonError(c, "not_found", "Submission not found");
  return c.json(diff);
});

adminRoutes.post("/submissions/:id/recheck", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const target = await c.env.DB.prepare(`
    SELECT status, check_status FROM submissions WHERE id = ?
  `).bind(c.req.param("id")).first<{ status: string; check_status: string }>();
  if (!target) return jsonError(c, "not_found", "Submission not found");
  if (target.status !== "pending" && target.status !== "checking") {
    return jsonError(c, "conflict", "Submission is already resolved");
  }
  if (target.check_status === "queued" || target.check_status === "running") {
    return jsonError(c, "conflict", "Checker is already running");
  }
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE submissions
      SET status = 'checking', check_status = 'queued', check_attempts = 0,
          check_lease_until = NULL, check_error = NULL
      WHERE id = ? AND status IN ('pending', 'checking') AND check_status NOT IN ('queued', 'running')
    `).bind(c.req.param("id")),
    c.env.DB.prepare(`
      INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      SELECT ?, 'checker.recheck', 'submission', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM submissions WHERE id = ? AND check_status = 'queued')
    `).bind(
      crypto.randomUUID(), c.req.param("id"), session.userId,
      JSON.stringify({ reason: "explicit reviewer recheck" }), now, c.req.param("id"),
    ),
  ]);
  try {
    c.executionCtx.waitUntil(
      enqueueSubmission(c.env, c.req.param("id")).catch(error => {
        console.error("ContentService recheck failed", error);
      }),
    );
  } catch {
    // Direct route tests have no ExecutionContext.
  }
  return c.json({ ok: true, status: "queued" }, 202);
});

adminRoutes.post("/submissions/:id/review", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const parsed = adminReviewRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid review", parsed.error.flatten());

  const result = await reviewAdminSubmission(c.env.DB, c.req.param("id"), session.userId, parsed.data);
  if (result.kind === "not_found") return jsonError(c, "not_found", "Submission not found");
  if (result.kind === "invalid_reason") return jsonError(c, "bad_request", "拒绝时必须填写理由");
  if (result.kind === "conflict") return jsonError(c, "conflict", "Submission has already been reviewed");
  return c.json({ id: result.id, status: result.status }, 201);
});

adminRoutes.get("/projects", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const parsed = adminListQuerySchema.safeParse({
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
  });
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid query", parsed.error.flatten());
  return c.json(await listAdminProjects(c.env.DB, parsed.data.limit, parsed.data.cursor));
});

adminRoutes.get("/members", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const parsed = adminListQuerySchema.safeParse({
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
  });
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid query", parsed.error.flatten());
  return c.json(await listAdminMembers(c.env.DB, parsed.data.limit, parsed.data.cursor));
});

adminRoutes.put("/members/:id/role", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  if (session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const parsed = adminRoleRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid role", parsed.error.flatten());

  const result = await changeAdminMemberRole(c.env.DB, c.req.param("id"), parsed.data.role, session.userId);
  if (result.kind === "not_found") return jsonError(c, "not_found", "Member not found");
  if (result.kind === "last_owner") return jsonError(c, "conflict", "Cannot demote the last owner");
  return c.json({ ok: true });
});

adminRoutes.get("/audit-events", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const parsed = adminAuditEventListQuerySchema.safeParse({
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
    action: c.req.query("action"),
  });
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid query", parsed.error.flatten());
  return c.json(await listAdminAuditEvents(c.env.DB, parsed.data.limit, parsed.data.cursor, parsed.data.action));
});

adminRoutes.put("/recommendations/:projectId", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false || session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const parsed = adminRecommendationUpdateSchema.safeParse(await readJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid recommendation", parsed.error.flatten());
  const result = await updateAdminRecommendation(c.env.DB, c.req.param("projectId"), session.userId, parsed.data);
  if (result.kind === "not_found") return jsonError(c, "not_found", "Project not found");
  return c.json({ id: result.id, comment: result.comment, reaction: result.reaction });
});

adminRoutes.delete("/recommendations/:projectId", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false || session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const result = await deleteAdminRecommendation(c.env.DB, c.req.param("projectId"), session.userId);
  if (result.kind === "not_found") return jsonError(c, "not_found", "Recommendation not found");
  return c.body(null, 204);
});

adminRoutes.put("/reference-sets/:id", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false || session.role !== "owner") return jsonError(c, "forbidden", "Owner role required");
  const parsed = adminReferenceSetUpdateSchema.safeParse(await readJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid reference set", parsed.error.flatten());
  const result = await updateAdminReferenceSet(c.env.DB, c.req.param("id"), session.userId, parsed.data);
  if (result.kind === "not_found") return jsonError(c, "not_found", "Reference set not found");
  return c.json({ ok: true });
});
