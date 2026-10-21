import { Hono } from "hono";
import type { Env } from "../../env";
import { listReferenceSets } from "../../storage/references.js";
import { jsonError } from "../errors.js";

export const referenceRoutes = new Hono<{ Bindings: Env }>();

referenceRoutes.get("/", async (c) => {
  return c.json({ items: await listReferenceSets(c.env.DB) });
});

referenceRoutes.get("/:id", async (c) => {
  const sets = await listReferenceSets(c.env.DB);
  const set = sets.find((item) => item.id === c.req.param("id"));
  if (!set) return jsonError(c, "not_found", "Reference set not found");
  return c.json(set);
});
