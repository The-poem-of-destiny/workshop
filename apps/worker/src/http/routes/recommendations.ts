import { Hono } from "hono";
import type { Env } from "../../env";
import { listRecommendations } from "../../storage/home.js";

export const recommendationRoutes = new Hono<{ Bindings: Env }>();

recommendationRoutes.get("/", async (c) => {
  return c.json({ items: await listRecommendations(c.env.DB) });
});
