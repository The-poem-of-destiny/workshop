import { Hono } from "hono";
import { dataClient } from "../../data-client.js";
import type { Env } from "../../env";

export const downloadRoutes = new Hono<{ Bindings: Env }>();

downloadRoutes.get("/:projectId/:versionId/:kind", (c) => dataClient(c.executionCtx).fetch(c.req.raw));
