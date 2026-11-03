import { app } from "./app";
import { fetchPublic } from "./data-client";
import type { Env } from "./env";
import { canonicalPublicRequest } from "./http/public-cache";
import { publicResponse } from "./http/public-response";
import { runScheduled } from "./scheduler";
import { barrierControl, maintenanceUnavailable, withWriteBarrier } from "./write-barrier";

export { ContentService } from "./content-service";
export { CachedReads } from "./data/cached-reads";
export { DataService } from "./data/service";
export { WriteBarrier } from "./write-barrier";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (new URL(request.url).pathname === "/api/v1/maintenance") return barrierControl(request, env);
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
