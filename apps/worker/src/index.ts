import { app, applicationRequestSettled } from "./app";
import { canonicalPublicRequest } from "./cache/public-cache";
import { fetchPublic } from "./data-client";
import type { Env } from "./env";
import { publicResponse } from "./http/public-response";
import { isReadOnlyRequest } from "./http/read-only-request";
import { isStorageQuotaError, quotaExceededMessage } from "./quota-error";
import { runScheduled } from "./scheduler";
import {
  barrierControl,
  isMaintenanceUnavailableError,
  maintenanceUnavailable,
  withWriteBarrier,
} from "./write-barrier";

export { ContentService } from "./content-service";
export { CachedReads } from "./data/cached-reads";
export { DataService } from "./data/service";
export { WriteBarrier } from "./write-barrier";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const incoming = new URL(request.url);
    const pathname = incoming.pathname;
    if (pathname === "/api/v1/maintenance") return barrierControl(request, env);
    // Build assets are served exclusively by the static binding, never by R2.
    if (pathname.startsWith("/assets/") && (request.method === "GET" || request.method === "HEAD")) {
      if (!env.ASSETS) return new Response("Not found", { status: 404 });
      const response = await env.ASSETS.fetch(request);
      if (!response.ok) return response;
      const headers = new Headers(response.headers);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      headers.set("x-content-type-options", "nosniff");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    const gatewayRead = handleGatewayRead(request, incoming, env, ctx);
    if (gatewayRead) return gatewayRead;
    if (isReadOnlyRequest(request.method, pathname)) return app.fetch(request, env, ctx);
    const pending: Promise<{ error?: unknown }>[] = [];
    const guardedContext = new Proxy(ctx, {
      get(target, property) {
        if (property === "waitUntil")
          return (promise: Promise<unknown>) => {
            pending.push(
              Promise.resolve(promise).then(
                () => ({}),
                (error: unknown) => ({ error }),
              ),
            );
            target.waitUntil(promise);
          };
        return Reflect.get(target, property, target);
      },
    });
    let respond!: (response: Response) => void;
    const responseReady = new Promise<Response>((resolve) => {
      respond = resolve;
    });
    const work = withWriteBarrier(
      env,
      "request",
      async () => {
        respond(await app.fetch(request, env, guardedContext));
        for (let offset = 0; offset < pending.length; ) {
          const batch = pending.slice(offset);
          offset += batch.length;
          const outcomes = await Promise.all(batch);
          const failure = outcomes.find((outcome) => "error" in outcome);
          if (failure) throw failure.error;
        }
      },
      () => applicationRequestSettled(request),
    ).then(
      (result) => {
        if (!result.admitted) respond(maintenanceUnavailable());
      },
      (error: unknown) => {
        console.error("Maintenance barrier request failed", error);
        respond(maintenanceUnavailable());
      },
    );
    ctx.waitUntil(work);
    return responseReady;
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(
      withWriteBarrier(env, "scheduled", async () => {
        try {
          await runScheduled(env, ctx.exports, event.scheduledTime);
        } catch (error) {
          if (isMaintenanceUnavailableError(error)) {
            console.error("Scheduled work stopped by maintenance barrier");
            return;
          }
          throw error;
        }
      }).then((result) => {
        if (!result.admitted) console.error("Scheduled work blocked by maintenance barrier");
      }),
    );
  },
} satisfies ExportedHandler<Env>;

function handleGatewayRead(request: Request, incoming: URL, env: Env, ctx: ExecutionContext) {
  const { pathname } = incoming;
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    (pathname === "/" || pathname === "/index.html" || pathname === "/favicon.svg" || pathname === "/discord.svg")
  ) {
    if (!env.ASSETS) return new Response("Not found", { status: 404 });
    return pathname === "/" || pathname === "/index.html" ? htmlAsset(request, env) : env.ASSETS.fetch(request);
  }
  const publicRequest = canonicalPublicRequest(request.method, incoming);
  if (publicRequest.kind === "invalid") {
    return Response.json(
      { error: { code: "bad_request", message: "Invalid public query" } },
      {
        status: 400,
        headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
      },
    );
  }
  if (publicRequest.kind === "public") return fetchGatewayPublic(request, publicRequest.read, ctx);
}

async function htmlAsset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS!.fetch(request);
  const policy = response.headers.get("content-security-policy");
  if (!policy || !env.PUBLIC_ASSETS_BASE_URL) return response;
  const origin = new URL(env.PUBLIC_ASSETS_BASE_URL);
  if (origin.protocol !== "https:" || origin.href !== `${origin.origin}/`) return response;
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", policy.replace("img-src 'self'", `img-src 'self' ${origin.origin}`));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function fetchGatewayPublic(
  request: Request,
  read: Extract<ReturnType<typeof canonicalPublicRequest>, { kind: "public" }>["read"],
  ctx: ExecutionContext,
): Promise<Response> {
  try {
    return publicResponse(await fetchPublic(ctx, request.method, read), read.category, request.headers);
  } catch (error) {
    console.error("Unhandled worker error", error);
    const quota = isStorageQuotaError(error);
    return publicResponse(
      Response.json(
        {
          error: {
            code: quota ? "quota_exceeded" : "internal",
            message: quota ? quotaExceededMessage() : "Internal server error",
          },
        },
        { status: quota ? 503 : 500 },
      ),
      read.category,
      request.headers,
    );
  }
}
