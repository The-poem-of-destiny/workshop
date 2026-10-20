interface Env {
  DB: D1Database;
  R2: R2Bucket;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/v1/health") {
      return json({
        ok: true,
        service: "workshop",
        bindings: {
          db: Boolean(env.DB),
          r2: Boolean(env.R2),
        },
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return json(
        { error: { code: "not_found", message: "Not found" } },
        404,
      );
    }

    if (url.pathname === "/") {
      return new Response("workshop staging", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "private, no-store",
        },
      });
    }

    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
  },
} satisfies ExportedHandler<Env>;
