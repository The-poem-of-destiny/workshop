import { Hono } from "hono";
import type { Env } from "../../env";

export const downloadRoutes = new Hono<{ Bindings: Env }>();

downloadRoutes.get("/:token", (c) => c.executionCtx.exports.DataService.fetch(c.req.raw));
