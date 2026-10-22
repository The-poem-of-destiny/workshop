import { WorkerEntrypoint } from "cloudflare:workers";
import { app } from "./app";
import type { Env } from "./env";
import { canonicalPublicRequest, type PublicCacheProps, readPublicEpoch } from "./http/public-cache";
import { runScheduled } from "./scheduler";

export { ContentService } from "./content-service";

function gatewayResponse(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  headers.delete("cdn-cache-control");
  headers.delete("cloudflare-cdn-cache-control");
  headers.delete("cache-tag");

  const immutableArtifact =
    /^\/client\/(?:v\/[a-f0-9]{8,64}\/index\.js|checker\/v\/[a-f0-9]{8,64}\/(?:browser-checker\.js|upload-checker\.mjs|review-checker\.mjs|manifest\.json|NOTICES\.txt))$/.test(
      new URL(request.url).pathname,
    );
  if (!immutableArtifact) {
    headers.delete("cache-control");
    headers.set("cache-control", "private, no-store");
  }

  const origin = request.headers.get("origin");
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  } else if (!immutableArtifact) {
    headers.delete("access-control-allow-origin");
    headers.delete("vary");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export class Public extends WorkerEntrypoint<Env, PublicCacheProps> {
  override async fetch(request: Request): Promise<Response> {
    if (!/^\d+$/.test(this.ctx.props.publicEpoch)) {
      return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), {
        status: 404,
        headers: { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8" },
      });
    }

    const publicRequest = canonicalPublicRequest(request);
    if (publicRequest.kind !== "public") {
      return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), {
        status: 404,
        headers: { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8" },
      });
    }

    const response = await app.fetch(publicRequest.request, this.env, this.ctx);
    const headers = new Headers(response.headers);
    headers.delete("cdn-cache-control");
    headers.delete("cloudflare-cdn-cache-control");
    headers.delete("cache-tag");
    if (response.ok && !headers.has("set-cookie")) {
      if (!headers.get("cache-control")?.includes("immutable")) {
        headers.set("cache-control", "public, max-age=30, stale-if-error=0");
      }
    } else {
      headers.set("cache-control", "private, no-store");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const publicRequest = canonicalPublicRequest(request);
    if (publicRequest.kind === "invalid") {
      return new Response(JSON.stringify({ error: { code: "bad_request", message: "Invalid public query" } }), {
        status: 400,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (publicRequest.kind !== "public") return app.fetch(request, env, ctx);
    if (request.headers.has("authorization") || request.headers.has("cookie")) {
      return gatewayResponse(await app.fetch(request, env, ctx), request, env);
    }

    const epoch = await readPublicEpoch(env.DB);
    if (epoch === null) {
      return new Response(
        JSON.stringify({ error: { code: "internal", message: "Public data is temporarily unavailable" } }),
        {
          status: 503,
          headers: {
            "cache-control": "private, no-store",
            "content-type": "application/json; charset=utf-8",
            "x-content-type-options": "nosniff",
          },
        },
      );
    }

    const response = await ctx.exports.Public({ props: { publicEpoch: epoch } }).fetch(publicRequest.request);
    return gatewayResponse(response, request, env);
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env, event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
