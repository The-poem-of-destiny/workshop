import { app } from "./app";
import { fetchPublic } from "./data-client";
import type { Env } from "./env";
import { canonicalPublicRequest } from "./http/public-cache";
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
      // Public projections receive canonical requests without identity headers.
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
    return app.fetch(request, env, ctx);
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env, ctx.exports, event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
