import { homeResponseSchema } from "@workshop/contracts";
import { Hono } from "hono";
import type { Env } from "../../env";
import { getHome } from "../../storage/home.js";

export const homeRoutes = new Hono<{ Bindings: Env }>();

homeRoutes.get("/", async (c) => c.json(homeResponseSchema.parse(await getHome(c.env.DB))));
