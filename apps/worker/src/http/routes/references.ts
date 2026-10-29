import { Hono } from "hono";
import { fetchPublic } from "../../data-client";
import type { Env } from "../../env";

export const referenceRoutes = new Hono<{ Bindings: Env }>();
referenceRoutes.get("/", (c) => fetchPublic(c.executionCtx, c.req.raw));
referenceRoutes.get("/:id", (c) => fetchPublic(c.executionCtx, c.req.raw));
