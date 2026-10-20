import { Hono } from "hono";
import type { Env } from "../../env";
import { getBanner } from "../../storage/home.js";

export const siteRoutes = new Hono<{ Bindings: Env }>();

siteRoutes.get("/", async c => c.json({ banner: await getBanner(c.env.DB) }));
