import { Hono } from "hono";
import type { Env } from "../../env";
import { jsonError } from "../errors.js";

export const clientRoutes = new Hono<{ Bindings: Env }>();

function assetHeaders(key: string, immutable: boolean): Headers {
  const headers = new Headers();
  headers.set("content-type", "text/javascript; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  headers.set("cross-origin-resource-policy", "cross-origin");
  headers.set("x-content-type-options", "nosniff");
  if (immutable) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("cloudflare-cdn-cache-control", "public, max-age=31536000, immutable");
    headers.set("cache-tag", `client:v:${key.split("/")[2] ?? "unknown"}`);
  } else {
    headers.set("cache-control", "no-store");
  }
  return headers;
}

clientRoutes.get("/checker/v/:revision/:file", async (c) => {
  const revision = c.req.param("revision");
  const file = c.req.param("file");
  if (!/^[a-f0-9]{8,64}$/.test(revision)) return jsonError(c, "not_found", "Checker asset not found");
  const allowed: Record<string, string> = {
    "browser-checker.js": "text/javascript; charset=utf-8",
    "upload-checker.mjs": "text/javascript; charset=utf-8",
    "review-checker.mjs": "text/javascript; charset=utf-8",
    "manifest.json": "application/json; charset=utf-8",
    "NOTICES.txt": "text/plain; charset=utf-8",
  };
  const contentType = allowed[file];
  if (!contentType) return jsonError(c, "not_found", "Checker asset not found");
  const key = `checker/v/${revision}/${file}`;
  const object = await c.env.R2.get(key);
  if (!object) return jsonError(c, "not_found", "Checker asset not found");
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "public, max-age=31536000, immutable",
    "cloudflare-cdn-cache-control": "public, max-age=31536000, immutable",
    "cache-tag": `checker:v:${revision}`,
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
    "x-content-type-options": "nosniff",
    etag: object.httpEtag,
  });
  if (c.req.header("if-none-match") === object.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
});

clientRoutes.get("/*", async (c) => {
  const path = c.req.path.replace(/^\/client\/?/, "");
  const versioned = /^v\/([a-f0-9]{8,64})\/index\.js$/.exec(path);
  const channel = /^(stable|staging)\/index\.js$/.exec(path);
  if (!versioned && !channel) return jsonError(c, "not_found", "Client asset not found");

  const key = `client/${path}`;
  const object = await c.env.R2.get(key);
  if (!object) return jsonError(c, "not_found", "Client asset not found");
  const headers = assetHeaders(key, Boolean(versioned));
  const etag = object.httpEtag;
  headers.set("etag", etag);
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
});
