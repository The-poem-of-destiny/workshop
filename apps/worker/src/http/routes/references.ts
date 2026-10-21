import { Hono } from "hono";
import type { Env } from "../../env";
import { getReferenceSet, listReferenceSets } from "../../storage/references.js";
import { jsonError } from "../errors.js";

export const referenceRoutes = new Hono<{ Bindings: Env }>();

referenceRoutes.get("/", async (c) => {
  return c.json({ items: await listReferenceSets(c.env.DB) });
});

referenceRoutes.get("/:id", async (c) => {
  const set = await getReferenceSet(c.env.DB, c.req.param("id"));
  if (!set) return jsonError(c, "not_found", "Reference set not found");
  return c.json(set);
});
