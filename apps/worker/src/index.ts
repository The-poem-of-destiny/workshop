import { app } from "./app";
import type { Env } from "./env";
import { canonicalPublicRequest } from "./http/public-cache";
import { publicWritePaths, purgePublicPaths } from "./http/public-invalidation";
import { runScheduled } from "./scheduler";

export { ContentService } from "./content-service";

function publicResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("cdn-cache-control");
  headers.delete("cloudflare-cdn-cache-control");
  headers.delete("vary");
  headers.set("access-control-allow-origin", "*");
  if (response.ok && !headers.has("set-cookie")) {
    if (!headers.get("cache-control")?.includes("immutable")) {
      headers.set("cache-control", "public, max-age=300, stale-if-error=0");
    }
  } else {
    headers.set("cache-control", "private, no-store");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const publicRequest = canonicalPublicRequest(request);
    if (publicRequest.kind === "invalid") {
      return Response.json(
        { error: { code: "bad_request", message: "Invalid public query" } },
        {
          status: 400,
          headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
        },
      );
    }
    if (publicRequest.kind === "public") {
      // No identity-bearing request ever reaches a public projection. The
      // entrypoint cache may answer before this code executes, so these URLs
      // must never fall back to private data.
      return publicResponse(await app.fetch(publicRequest.request, env, ctx));
    }
    const response = await app.fetch(request, env, ctx);
    const paths = publicWritePaths(request);
    if (response.ok && paths.length) ctx.waitUntil(purgePublicPaths(paths));
    return response;
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env, event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
