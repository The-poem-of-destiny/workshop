import { Hono } from "hono";
import {
  adminListQuerySchema,
  adminReviewRequestSchema,
  adminRoleRequestSchema,
  adminSubmissionListQuerySchema,
} from "@workshop/contracts";
import type { Env } from "../../env.js";
import {
  changeAdminMemberRole,
  getAdminSubmission,
  getSubmissionAsset,
  listAdminMembers,
  listAdminProjects,
  listAdminSubmissions,
  reviewAdminSubmission,
} from "../../storage/admin.js";
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
  if (kind !== "worldbook" && kind !== "regex") {
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

adminRoutes.post("/submissions/:id/review", async c => {
  const session = await requireReviewer(c);
  if (session === null) return jsonError(c, "unauthorized", "Login required");
  if (session === false) return jsonError(c, "forbidden", "Reviewer role required");
  const parsed = adminReviewRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid review", parsed.error.flatten());

  const result = await reviewAdminSubmission(c.env.DB, c.req.param("id"), session.userId, parsed.data);
  if (result.kind === "not_found") return jsonError(c, "not_found", "Submission not found");
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
