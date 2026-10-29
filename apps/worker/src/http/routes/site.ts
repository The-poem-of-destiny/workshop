import { Hono } from "hono";
import { dataClient, fetchPublic } from "../../data-client";
import type { Env } from "../../env";
import { jsonError } from "../errors.js";

export const siteRoutes = new Hono<{ Bindings: Env }>();
siteRoutes.get("/", (c) => fetchPublic(c.executionCtx, c.req.raw));
siteRoutes.post("/banner", (c) => dataClient(c.executionCtx).fetch(c.req.raw));
siteRoutes.put("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json<unknown>();
  } catch {
    body = undefined;
  }
  const result = await dataClient(c.executionCtx).distributionUpdateSite(c.req.header("authorization"), body);
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "forbidden") return jsonError(c, "forbidden", "Owner role required");
  if (result.kind === "invalid") {
    const fieldErrors: Record<string, string[]> = {};
    for (const { field, messages } of result.fieldErrors) {
      const values: string[] = [];
      for (const message of messages) values.push(message);
      fieldErrors[field] = values;
    }
    const formErrors: string[] = result.formErrors.map((message) => message);
    return jsonError(c, "bad_request", "Invalid site settings", { formErrors, fieldErrors });
  }
  if (result.kind === "empty") return jsonError(c, "bad_request", "No site settings provided");
  return new Response(JSON.stringify(result.data), { headers: { "content-type": "application/json; charset=UTF-8" } });
});
