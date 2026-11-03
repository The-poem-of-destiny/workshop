import { adminRecommendationUpdateSchema } from "@workshop/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { fetchPublic } from "../../data-client";
import type { Env } from "../../env";
import { jsonError } from "../errors.js";
import { sessionToken } from "../session.js";

export const recommendationRoutes = new Hono<{ Bindings: Env }>();
recommendationRoutes.get("/", (c) => fetchPublic(c.executionCtx, c.req.raw));

const changeSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    projectVersionId: z.string().min(1).max(200),
    previousVersionId: z.string().min(1).max(200),
    previousManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    currentManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    changedEntries: z.number().int().min(1).max(20000),
    totalEntries: z.number().int().min(1).max(20000),
  })
  .strict()
  .refine((v) => v.changedEntries <= v.totalEntries);
recommendationRoutes.post("/changes", async (c) => {
  const input = changeSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return jsonError(c, "bad_request", "Invalid content change signal");
  const result = await c.executionCtx.exports.DataService.projectChangeSignal(sessionToken(c), input.data);
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "not_found") return jsonError(c, "not_found", "Content change evidence unavailable");
  return c.json(result);
});

for (const method of ["put", "delete"] as const) {
  recommendationRoutes[method]("/:projectId", async (c) => {
    const body = adminRecommendationUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return jsonError(c, "bad_request", "Invalid version recommendation");
    const result = await c.executionCtx.exports.DataService.projectRecommendation(
      sessionToken(c),
      c.req.param("projectId"),
      body.data,
      method === "delete",
    );
    if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (result.kind === "not_found") return jsonError(c, "not_found", "Published version not found");
    return c.json(result);
  });
}
