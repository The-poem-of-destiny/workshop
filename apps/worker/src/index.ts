import { app } from "./app";
import { fetchPublic } from "./data-client";
import type { Env } from "./env";
import { canonicalPublicRequest } from "./http/public-cache";
import { publicWritePaths, purgePublicPaths } from "./http/public-invalidation";
import { publicResponse } from "./http/public-response";
import { runScheduled } from "./scheduler";

export { ContentService } from "./content-service";
export { CachedReads } from "./data/cached-reads";
export { DataService } from "./data/service";

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
      try {
        return publicResponse(await fetchPublic(ctx, publicRequest.request), request);
      } catch (error) {
        console.error("Unhandled worker error", error);
        return publicResponse(
          Response.json({ error: { code: "internal", message: "Internal server error" } }, { status: 500 }),
          request,
        );
      }
    }
    const response = await app.fetch(request, env, ctx);
    const paths = publicWritePaths(request);
    if (response.ok && paths.length) ctx.waitUntil(purgePublicPaths(paths));
    return response;
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env, ctx.exports, event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
