import { Hono } from "hono";
import type { Env } from "../../env";
import { getHome } from "../../storage/home.js";

export const homeRoutes = new Hono<{ Bindings: Env }>();

homeRoutes.get("/", async (c) => c.json(await getHome(c.env.DB)));
