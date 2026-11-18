import { createCollectionSchema, patchCollectionSchema } from "@workshop/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Env } from "../../env.js";
import { jsonError } from "../errors.js";
import { sessionOrError } from "./authoring-request.js";

async function bodyJson(c: Context<{ Bindings: Env }>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export const collectionsRoutes = new Hono<{ Bindings: Env }>();
export const authorsRoutes = new Hono<{ Bindings: Env }>();

collectionsRoutes.get("/:id", async (c) => {
  const collection = await c.executionCtx.exports.DataService.collectionPublicGet(c.req.param("id"));
  if (!collection) return jsonError(c, "not_found", "合集不存在或暂无公开作品");
  return c.json(collection);
});

collectionsRoutes.post("/", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const parsed = createCollectionSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "合集信息无效", parsed.error.flatten());
  const result = await c.executionCtx.exports.DataService.authorCreateCollection(
    c.req.header("authorization"),
    parsed.data,
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "forbidden") return jsonError(c, "forbidden", "请先阅读并同意工坊使用政策并完成准入问答");
  if (result.kind === "forbidden_project") return jsonError(c, "forbidden", "只能将自己的作品加入合集");
  if (result.kind === "invalid") return jsonError(c, "bad_request", result.message);
  return c.json(result.data, 201);
});

collectionsRoutes.patch("/:id", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const parsed = patchCollectionSchema.safeParse(await bodyJson(c));
  if (!parsed.success) return jsonError(c, "bad_request", "合集信息无效", parsed.error.flatten());
  const result = await c.executionCtx.exports.DataService.authorPatchCollection(
    c.req.header("authorization"),
    c.req.param("id"),
    parsed.data,
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "forbidden") return jsonError(c, "forbidden", "请先阅读并同意工坊使用政策并完成准入问答");
  if (result.kind === "not_found") return jsonError(c, "not_found", "合集不存在");
  if (result.kind === "forbidden_project") return jsonError(c, "forbidden", "只能将自己的作品加入合集");
  if (result.kind === "invalid") return jsonError(c, "bad_request", result.message);
  return c.json(result.data);
});

collectionsRoutes.delete("/:id", async (c) => {
  const auth = await sessionOrError(c);
  if (!auth.session) return auth.response;
  const result = await c.executionCtx.exports.DataService.authorDeleteCollection(
    c.req.header("authorization"),
    c.req.param("id"),
  );
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "forbidden") return jsonError(c, "forbidden", "请先阅读并同意工坊使用政策并完成准入问答");
  if (result.kind === "not_found") return jsonError(c, "not_found", "合集不存在");
  return c.body(null, 204);
});

authorsRoutes.get("/:id", async (c) => {
  const profile = await c.executionCtx.exports.DataService.authorPublicProfile(c.req.param("id"));
  if (!profile) return jsonError(c, "not_found", "作者不存在或暂无公开作品");
  return c.json(profile);
});
