import { Hono } from "hono";
import { fetchPublic } from "../../data-client";
import type { Env } from "../../env";

export const recommendationRoutes = new Hono<{ Bindings: Env }>();
recommendationRoutes.get("/", (c) => fetchPublic(c.executionCtx, c.req.raw));
