import { app } from "./app";
import { fetchPublic } from "./data-client";
import type { Env } from "./env";
import { canonicalPublicRequest } from "./http/public-cache";
import { publicResponse } from "./http/public-response";
import { runScheduled } from "./scheduler";
import { barrierControl, maintenanceDocument, maintenanceUnavailable, withWriteBarrier } from "./write-barrier";

export { ContentService } from "./content-service";
export { CachedReads } from "./data/cached-reads";
export { DataService } from "./data/service";
export { WriteBarrier } from "./write-barrier";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const pathname = new URL(request.url).pathname;
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
    const unavailable = () => {
      const isApplicationRoute =
        pathname === "/api" ||
        pathname.startsWith("/api/") ||
        pathname === "/client" ||
        pathname.startsWith("/client/");
      const isDocument =
        request.headers.get("sec-fetch-dest") === "document" || request.headers.get("accept")?.includes("text/html");
      return !isApplicationRoute && isDocument ? maintenanceDocument() : maintenanceUnavailable();
    };
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
    const work = withWriteBarrier(env, "request", async () => {
      const response = await handleRequest(request, env, guardedContext);
      const tracked = trackResponse(response);
      respond(tracked.response);
      await tracked.finished;
      for (let offset = 0; offset < pending.length; ) {
        const batch = pending.slice(offset);
        offset += batch.length;
        const outcomes = await Promise.all(batch);
        const failure = outcomes.find((outcome) => "error" in outcome);
        if (failure) throw failure.error;
      }
    }).then(
      (result) => {
        if (!result.admitted) respond(unavailable());
      },
      (error: unknown) => {
        console.error("Maintenance barrier request failed", error);
        respond(unavailable());
      },
    );
    ctx.waitUntil(work);
    return responseReady;
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(
      withWriteBarrier(env, "scheduled", () => runScheduled(env, ctx.exports, event.scheduledTime)).then((result) => {
        if (!result.admitted) console.error("Scheduled work blocked by maintenance barrier");
      }),
    );
  },
} satisfies ExportedHandler<Env>;

function trackResponse(response: Response): { response: Response; finished: Promise<void> } {
  if (!response.body) return { response, finished: Promise.resolve() };
  const reader = response.body.getReader();
  let complete!: () => void;
  let fail!: (error: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          complete();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
        fail(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
        complete();
      } catch (error) {
        fail(error);
        throw error;
      }
    },
  });
  return { response: new Response(body, response), finished };
}

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    (pathname === "/" || pathname === "/index.html" || pathname === "/favicon.svg" || pathname === "/discord.svg")
  ) {
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
  }
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
}
