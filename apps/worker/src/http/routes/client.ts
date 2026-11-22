import { Hono } from "hono";
import { dataClient } from "../../data-client";
import type { Env } from "../../env";

export const clientRoutes = new Hono<{ Bindings: Env }>();
clientRoutes.get("/*", (c) => dataClient(c.executionCtx).fetch(c.req.raw));
