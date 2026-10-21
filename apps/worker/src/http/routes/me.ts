import {
  authorProjectListResponseSchema,
  authorSubmissionListResponseSchema,
  meResponseSchema,
  meStateResponseSchema,
  ratingInputSchema,
} from "@workshop/contracts";
import { Hono } from "hono";
import type { Env } from "../../env";
import { listAuthorProjects, listAuthorSubmissions } from "../../storage/authoring.js";
import { getMe } from "../../storage/identity.js";
import {
  getInteractionState,
  interactionProjectExists,
  listSubscribedProjects,
  setLike,
  setRating,
  setSubscription,
  unsetLike,
  unsetRating,
  unsetSubscription,
} from "../../storage/interactions.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";

export const meRoutes = new Hono<{ Bindings: Env }>();

meRoutes.get("/", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const me = await getMe(c.env.DB, session.userId);
  if (!me) return jsonError(c, "unauthorized", "Login required");
  return c.json(meResponseSchema.parse(me));
});

meRoutes.get("/projects", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const items = await listAuthorProjects(c.env.DB, session);
  return c.json(authorProjectListResponseSchema.parse({ items }));
});

meRoutes.get("/projects/:id/submissions", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const items = await listAuthorSubmissions(c.env.DB, session, c.req.param("id"));
  if (!items) return jsonError(c, "not_found", "Project not found");
  return c.json(authorSubmissionListResponseSchema.parse({ items }));
});

meRoutes.get("/subscriptions", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  return c.json({ items: await listSubscribedProjects(c.env.DB, session.userId) });
});

meRoutes.get("/state", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const rawIds = c.req.query("ids") ?? "";
  const ids = rawIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length > 50) return jsonError(c, "bad_request", "At most 50 project IDs are allowed");
  const state = await getInteractionState(c.env.DB, session.userId, ids);
  return c.json(meStateResponseSchema.parse(state));
});

meRoutes.put("/likes/:id", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const projectId = c.req.param("id");
  if (!(await interactionProjectExists(c.env.DB, projectId))) return jsonError(c, "not_found", "Project not found");
  await setLike(c.env.DB, session.userId, projectId);
  return c.body(null, 204);
});

meRoutes.delete("/likes/:id", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const projectId = c.req.param("id");
  if (!(await interactionProjectExists(c.env.DB, projectId))) return jsonError(c, "not_found", "Project not found");
  await unsetLike(c.env.DB, session.userId, projectId);
  return c.body(null, 204);
});

meRoutes.put("/subscriptions/:id", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const projectId = c.req.param("id");
  if (!(await interactionProjectExists(c.env.DB, projectId))) return jsonError(c, "not_found", "Project not found");
  await setSubscription(c.env.DB, session.userId, projectId);
  return c.body(null, 204);
});

meRoutes.delete("/subscriptions/:id", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const projectId = c.req.param("id");
  if (!(await interactionProjectExists(c.env.DB, projectId))) return jsonError(c, "not_found", "Project not found");
  await unsetSubscription(c.env.DB, session.userId, projectId);
  return c.body(null, 204);
});

meRoutes.put("/ratings/:id", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const projectId = c.req.param("id");
  if (!(await interactionProjectExists(c.env.DB, projectId))) return jsonError(c, "not_found", "Project not found");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "bad_request", "Invalid JSON body");
  }
  const parsed = ratingInputSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid rating", parsed.error.flatten());
  await setRating(c.env.DB, session.userId, projectId, parsed.data);
  return c.body(null, 204);
});

meRoutes.delete("/ratings/:id", async (c) => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const projectId = c.req.param("id");
  if (!(await interactionProjectExists(c.env.DB, projectId))) return jsonError(c, "not_found", "Project not found");
  await unsetRating(c.env.DB, session.userId, projectId);
  return c.body(null, 204);
});
