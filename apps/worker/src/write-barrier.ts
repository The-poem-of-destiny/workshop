import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

const NAME = "application-writes";
const PREFIX = "ticket:";

type Ticket = { kind: string; startedAt: string };

export class WriteBarrier extends DurableObject<Env> {
  override fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const storage = this.ctx.storage;
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && path === "/acquire") {
        if (await storage.get<boolean>("closed")) return new Response(null, { status: 503 });
        const { id, kind } = (await request.json()) as { id: string; kind: string };
        await storage.put(`${PREFIX}${id}`, { kind, startedAt: new Date().toISOString() });
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST" && path === "/release") {
        const { id } = (await request.json()) as { id: string };
        await storage.delete(`${PREFIX}${id}`);
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST" && path === "/close") await storage.put("closed", true);
      if (
        (request.method === "GET" && path === "/status") ||
        (request.method === "POST" && (path === "/close" || path === "/open"))
      ) {
        const tickets = await storage.list<Ticket>({ prefix: PREFIX, limit: 100 });
        if (path === "/open") {
          if (tickets.size) return Response.json({ error: "not_drained" }, { status: 409 });
          await storage.put("closed", false);
        }
        const closed = (await storage.get<boolean>("closed")) === true;
        return Response.json(
          {
            closed,
            drained: closed && tickets.size === 0,
            outstanding: [...tickets].map(([key, value]) => ({ id: key.slice(PREFIX.length), ...value })),
            outstandingTruncated: tickets.size === 100,
          },
          { headers: { "cache-control": "no-store" } },
        );
      }
      return new Response(null, { status: 404 });
    });
  }
}

function coordinator(env: Env): DurableObjectStub {
  return env.WRITE_BARRIER.get(env.WRITE_BARRIER.idFromName(NAME));
}

export function maintenanceUnavailable(): Response {
  return Response.json(
    { error: { code: "maintenance", message: "Service temporarily unavailable" } },
    {
      status: 503,
      headers: { "cache-control": "private, no-store", "retry-after": "30" },
    },
  );
}

export function maintenanceDocument(): Response {
  return new Response(
    `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>服务维护中</title></head>
<body><main><h1>服务维护中</h1><p>创意工坊正在维护，暂时无法访问。请稍后重试。</p></main></body></html>`,
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "retry-after": "30",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function withWriteBarrier<T>(
  env: Env,
  kind: string,
  operation: () => Promise<T>,
): Promise<{ admitted: true; value: T } | { admitted: false }> {
  const id = crypto.randomUUID();
  const stub = coordinator(env);
  let admission: Response;
  try {
    admission = await stub.fetch("https://write-barrier/acquire", {
      method: "POST",
      body: JSON.stringify({ id, kind }),
    });
  } catch {
    return { admitted: false };
  }
  if (!admission.ok) return { admitted: false };
  // An interrupted or rejected operation is deliberately left outstanding.
  const value = await operation();
  const release = await stub.fetch("https://write-barrier/release", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  if (!release.ok) throw new Error("Maintenance barrier release failed");
  return { admitted: true, value };
}

export async function barrierControl(request: Request, env: Env): Promise<Response> {
  const expected = env.MAINTENANCE_TOKEN;
  const authorization = request.headers.get("authorization");
  if (!expected || !authorization?.startsWith("Bearer ")) return new Response(null, { status: 401 });
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(authorization.slice(7))),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i]! ^ right[i]!;
  if (mismatch !== 0) return new Response(null, { status: 401 });
  let path = "/status";
  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(null, { status: 400 });
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("action" in body) ||
      (body.action !== "close" && body.action !== "open")
    )
      return new Response(null, { status: 400 });
    path = `/${body.action}`;
  } else if (request.method !== "GET") return new Response(null, { status: 405 });
  try {
    return await coordinator(env).fetch(`https://write-barrier${path}`, { method: request.method });
  } catch {
    return maintenanceUnavailable();
  }
}
