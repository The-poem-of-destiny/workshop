import { Hono } from "hono";
import { fetchPublic } from "../../data-client";
import type { Env } from "../../env";

export const homeRoutes = new Hono<{ Bindings: Env }>();

homeRoutes.get("/", (c) => fetchPublic(c.executionCtx, c.req.raw));
