import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { ContentService } from "../src/content-service";
import { CachedReads, type ReadProps } from "../src/data/cached-reads";
import type { DataEnv } from "../src/data/env";
import { guardedStorageEnv } from "../src/data/storage-guard";
import type { Env } from "../src/env";
import worker from "../src/index";
import { barrierControl } from "../src/write-barrier";
import { applySchema } from "./support/schema";

function isolatedEnv(): DataEnv {
  const bindings = env as unknown as DataEnv;
  const namespace = bindings.WRITE_BARRIER;
  const id = namespace.idFromName(crypto.randomUUID());
  return {
    ...bindings,
    MAINTENANCE_TOKEN: "test-operator-secret",
    WRITE_BARRIER: { idFromName: () => id, get: () => namespace.get(id) } as unknown as Env["WRITE_BARRIER"],
  };
}

function control(bindings: Env, action?: "close" | "open") {
  return barrierControl(
    new Request("https://example.test/api/v1/maintenance", {
      method: action ? "POST" : "GET",
      headers: { authorization: "Bearer test-operator-secret" },
      ...(action ? { body: JSON.stringify({ action }) } : {}),
    }),
    bindings,
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function context(exports: object = {}) {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    exports,
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  } as unknown as ExecutionContext;
  return { ctx, pending };
}

function cachedReadsFactory(bindings: DataEnv) {
  return ({ props }: { props: ReadProps }) =>
    new CachedReads({ props } as unknown as ExecutionContext, { ...bindings, CACHE_TTL_PUBLIC_SECONDS: "0" });
}

function fetchWorker(path: string, bindings: Env, ctx: ExecutionContext, init?: RequestInit) {
  const request = new Request(`https://example.test${path}`, init) as Parameters<typeof worker.fetch>[0];
  return worker.fetch(request, bindings, ctx);
}

afterEach(() => vi.restoreAllMocks());

describe("maintenance runtime boundaries", () => {
  it("blocks write-capable requests while leaving authenticated maintenance controls reachable", async () => {
    const bindings = isolatedEnv();
    const { ctx, pending } = context();
    const close = await fetchWorker("/api/v1/maintenance", bindings, ctx, {
      method: "POST",
      headers: { authorization: "Bearer test-operator-secret" },
      body: JSON.stringify({ action: "close" }),
    });
    expect(close.status).toBe(200);
    expect(await close.json()).toEqual({ closed: true, drained: true, outstanding: [], outstandingTruncated: false });

    const handler = vi.spyOn(app, "fetch");
    for (const [method, path] of [
      ["DELETE", "/api/v1/sessions/current"],
      ["GET", "/api/v1/me"],
      ["GET", "/api/v1/auth/callback?state=test-state"],
      ["HEAD", "/api/v1/downloads/project/version/worldbook"],
      ["GET", "/api/v1/unknown"],
    ] as const) {
      const response = await fetchWorker(path, bindings, ctx, {
        method,
        headers: { authorization: "Bearer not-an-operator", accept: "text/html" },
      });
      expect(response.status, `${method} ${path}`).toBe(503);
      expect(response.headers.get("cache-control"), `${method} ${path}`).toContain("no-store");
      expect(response.headers.get("retry-after"), `${method} ${path}`).toBeTruthy();
      if (method !== "HEAD") {
        expect(await response.json(), `${method} ${path}`).toMatchObject({ error: { code: "maintenance" } });
      }
    }
    expect(handler).not.toHaveBeenCalled();

    expect((await fetchWorker("/api/v1/maintenance", bindings, ctx)).status).toBe(401);
    const status = await fetchWorker("/api/v1/maintenance", bindings, ctx, {
      headers: { authorization: "Bearer test-operator-secret" },
    });
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("no-store");
    expect(await status.json()).toEqual({ closed: true, drained: true, outstanding: [], outstandingTruncated: false });

    const open = await fetchWorker("/api/v1/maintenance", bindings, ctx, {
      method: "POST",
      headers: { authorization: "Bearer test-operator-secret" },
      body: JSON.stringify({ action: "open" }),
    });
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ closed: false, drained: false, outstanding: [], outstandingTruncated: false });
    await Promise.all(pending);
  });

  it("serves the public catalogue and its exact count with writes closed", async () => {
    const bindings = isolatedEnv();
    await applySchema(bindings.DB);
    await bindings.DB.batch([
      bindings.DB.prepare("INSERT INTO users (id, username) VALUES ('author', 'author')"),
      bindings.DB.prepare(`INSERT INTO projects (id, author_id, visibility, published_at)
        VALUES ('project', 'author', 'public', '2026-01-01T00:00:00.000Z')`),
      bindings.DB.prepare(`INSERT INTO project_versions
        (id, project_id, version_no, title, project_type, created_by, entry_index)
        VALUES ('version', 'project', 1, 'Readable project', '角色', 'author', '{"schemaVersion":1,"entries":[]}')`),
      bindings.DB.prepare("UPDATE projects SET published_version_id = 'version' WHERE id = 'project'"),
    ]);
    await control(bindings, "close");
    const { ctx, pending } = context({
      CachedReads: cachedReadsFactory(bindings),
    });
    const catalogue = await fetchWorker("/api/v1/projects", bindings, ctx);
    expect(catalogue.status).toBe(200);
    expect(await catalogue.json()).toMatchObject({
      items: [{ title: "Readable project" }],
      total: 1,
      nextCursor: null,
    });
    await Promise.all(pending);
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true, outstanding: [] });
  });

  it("closes and drains while a verified client stream is still open", async () => {
    const bindings = isolatedEnv();
    const path = "/client/stable/index.js";
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const firstBody = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
      },
    });
    const fetchAsset = vi.fn(() => new Response("client after close")).mockReturnValueOnce(new Response(firstBody));
    const { ctx, pending } = context({ DataService: { fetch: fetchAsset } });
    const admitted = await fetchWorker(path, bindings, ctx);
    expect(admitted.status).toBe(200);
    try {
      expect(await (await control(bindings, "close")).json()).toMatchObject({
        closed: true,
        drained: true,
        outstanding: [],
      });
      const duringClose = await fetchWorker(path, bindings, ctx);
      expect(duringClose.status).toBe(200);
      expect(await duringClose.text()).toBe("client after close");
    } finally {
      stream.enqueue(new TextEncoder().encode("client before close"));
      stream.close();
    }
    expect(await admitted.text()).toBe("client before close");
    await Promise.all(pending);
  });

  it("serves JavaScript assets without consulting the barrier or business handlers", async () => {
    const bindings = isolatedEnv();
    const assets = bindings.ASSETS!;
    const assetUrl = "https://example.test/assets/fixture.js";

    const guardedBindings = {
      ...bindings,
      WRITE_BARRIER: {
        idFromName() {
          throw new Error("Static assets must not consult the barrier");
        },
      } as unknown as Env["WRITE_BARRIER"],
    };
    const handler = vi.spyOn(app, "fetch");
    const { ctx, pending } = context();
    const response = await worker.fetch(
      new Request(assetUrl) as Parameters<typeof worker.fetch>[0],
      guardedBindings,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/(?:javascript|ecmascript)/i);
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.get("cache-control")).toContain("max-age=31536000");
    expect(response.headers.get("cache-control")).toContain("immutable");
    const original = await assets.fetch(new Request(assetUrl));
    expect(await response.text()).toBe(await original.text());
    const missing = await worker.fetch(
      new Request("https://example.test/assets/missing.js") as Parameters<typeof worker.fetch>[0],
      guardedBindings,
      ctx,
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control") ?? "").not.toContain("immutable");
    expect(handler).not.toHaveBeenCalled();
    await Promise.all(pending);
  });

  it("keeps admitted writes outstanding through nested background work", async () => {
    const bindings = isolatedEnv();
    const first = deferred();
    const nested = deferred();
    const handler = vi.spyOn(app, "fetch").mockImplementationOnce((_request, _env, executionCtx) => {
      const ctx = executionCtx as ExecutionContext;
      ctx.waitUntil(
        first.promise.then(() => {
          ctx.waitUntil(nested.promise);
        }),
      );
      return new Response(null, { status: 204 });
    });
    const { ctx, pending } = context();
    const path = "/api/v1/sessions/current";
    const init = { method: "DELETE" };
    expect((await fetchWorker(path, bindings, ctx, init)).status).toBe(204);
    try {
      expect(await (await control(bindings, "close")).json()).toMatchObject({ closed: true, drained: false });
      expect((await fetchWorker(path, bindings, ctx, init)).status).toBe(503);
      expect(handler).toHaveBeenCalledTimes(1);

      first.resolve();
      await first.promise;
      expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: false });
      expect((await control(bindings, "open")).status).toBe(409);
    } finally {
      first.resolve();
      nested.resolve();
      await Promise.all(pending);
    }
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true });
    expect((await control(bindings, "open")).status).toBe(200);
  });

  it("retains an uncertain write when Hono handles the failure as HTTP 500", async () => {
    const bindings = isolatedEnv();
    const { ctx, pending } = context({
      DataService: {
        async identityRevoke() {
          throw new Error("unknown session revocation outcome");
        },
      },
    });
    const response = await fetchWorker("/api/v1/sessions/current", bindings, ctx, {
      method: "DELETE",
      headers: { authorization: "Bearer test-session" },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "internal" } });
    await Promise.all(pending);
    expect(await (await control(bindings, "close")).json()).toMatchObject({
      closed: true,
      drained: false,
      outstanding: [{ kind: "request" }],
      outstandingTruncated: false,
    });
    expect((await control(bindings, "open")).status).toBe(409);
  });

  it("blocks detached content work while closed and drains admitted work only after it finishes", async () => {
    const bindings = isolatedEnv();
    const entered = deferred();
    const finish = deferred();
    const contentGetTarget = vi.fn(async () => {
      entered.resolve();
      await finish.promise;
      return null;
    });
    const state = { exports: { DataService: { contentGetTarget } } } as unknown as DurableObjectState;
    const content = new ContentService(state, bindings);
    const request = () =>
      new Request("https://content-service/run", {
        method: "POST",
        body: JSON.stringify({ submissionId: "detached-check" }),
      });

    const admitted = content.fetch(request());
    const start = await Promise.race([entered.promise, admitted]);
    try {
      expect(start).toBeUndefined();
      expect(await (await control(bindings, "close")).json()).toMatchObject({ closed: true, drained: false });
      const blocked = await content.fetch(request());
      expect(blocked.status).toBe(503);
      expect(await blocked.json()).toMatchObject({ error: { code: "maintenance" } });
      expect(contentGetTarget).toHaveBeenCalledTimes(1);
    } finally {
      finish.resolve();
    }
    expect((await admitted).status).toBe(404);
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true });
  });

  it("tracks scheduled work until completion and blocks new scheduled work while closed", async () => {
    const bindings = isolatedEnv();
    const entered = deferred();
    const finish = deferred();
    const findDueSubmissions = vi.fn(async () => {
      entered.resolve();
      await finish.promise;
      return [];
    });
    const { ctx, pending } = context({ DataService: { findDueSubmissions } });
    const event = { scheduledTime: Date.UTC(2026, 0, 1, 1, 0), cron: "0 * * * *", noRetry() {} } as ScheduledController;
    worker.scheduled(event, bindings, ctx);
    await entered.promise;
    expect(await (await control(bindings, "close")).json()).toMatchObject({ closed: true, drained: false });
    worker.scheduled(event, bindings, ctx);
    await pending[1];
    expect(findDueSubmissions).toHaveBeenCalledTimes(1);
    finish.resolve();
    await Promise.all(pending);
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true });
  });

  it("keeps an admitted storage write outstanding until the write completes", async () => {
    const bindings = isolatedEnv();
    const key = `barrier-test/${crypto.randomUUID()}`;
    const entered = deferred();
    const finish = deferred();
    const bucket = new Proxy(bindings.R2, {
      get(target, property) {
        if (property === "put")
          return async (objectKey: string, value: string) => {
            entered.resolve();
            await finish.promise;
            return target.put(objectKey, value);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const guarded = guardedStorageEnv({ ...bindings, R2: bucket });
    const write = guarded.R2.put(key, "committed");
    await entered.promise;
    expect(await (await control(bindings, "close")).json()).toMatchObject({ closed: true, drained: false });
    expect((await control(bindings, "open")).status).toBe(409);
    finish.resolve();
    await write;
    expect(await (await bindings.R2.get(key))?.text()).toBe("committed");
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true });
    await bindings.R2.delete(key);
  });

  it("blocks D1 and R2 mutations without blocking reads and preserves stored data", async () => {
    const bindings = isolatedEnv();
    const guarded = guardedStorageEnv(bindings);
    const table = `barrier_${crypto.randomUUID().replaceAll("-", "")}`;
    const key = `barrier-test/${crypto.randomUUID()}`;
    await bindings.DB.exec(`CREATE TABLE ${table} (value TEXT)`);
    await bindings.DB.prepare(`INSERT INTO ${table} VALUES (?)`).bind("original").run();
    await bindings.R2.put(key, "original");
    const multipart = await guarded.R2.createMultipartUpload(`${key}-multipart`);
    await control(bindings, "close");

    await expect(guarded.DB.prepare(`INSERT INTO ${table} VALUES (?)`).bind("blocked").run()).rejects.toThrow(
      "Maintenance barrier closed or unavailable",
    );
    const select = guarded.DB.prepare(`SELECT value FROM ${table}`);
    await expect(guarded.DB.batch([select, guarded.DB.prepare(`DELETE FROM ${table}`)])).rejects.toThrow(
      "Maintenance barrier closed or unavailable",
    );
    await expect(guarded.R2.put(key, "blocked")).rejects.toThrow("Maintenance barrier closed or unavailable");
    await expect(guarded.R2.delete(key)).rejects.toThrow("Maintenance barrier closed or unavailable");
    await expect(multipart.uploadPart(1, new Uint8Array([1]))).rejects.toThrow(
      "Maintenance barrier closed or unavailable",
    );
    const readBatch = await guarded.DB.batch([select, guarded.DB.prepare(`SELECT COUNT(*) AS total FROM ${table}`)]);
    expect(readBatch.map((result) => result.results)).toEqual([[{ value: "original" }], [{ total: 1 }]]);
    expect(await (await guarded.R2.get(key))?.text()).toBe("original");
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true });
    await control(bindings, "open");
    await multipart.abort();
    await bindings.R2.delete(key);
    await bindings.DB.exec(`DROP TABLE ${table}`);
  });

  it("serves API CORS preflights without consulting WriteBarrier even while closed or broken", async () => {
    const bindings = isolatedEnv();
    const brokenBarrierEnv = {
      ...bindings,
      ALLOWED_ORIGINS: "https://example.test",
      WRITE_BARRIER: {
        idFromName() {
          throw new Error("CORS preflight must not hit WriteBarrier");
        },
      } as unknown as Env["WRITE_BARRIER"],
    };
    const { ctx, pending } = context();
    const response = await fetchWorker("/api/v1/projects", brokenBarrierEnv, ctx, {
      method: "OPTIONS",
      headers: { origin: "https://example.test" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://example.test");
    await Promise.all(pending);
  });

  it("releases outer tickets cleanly on mid-flight barrier close, read-only quota errors, and cleaned staging failures", async () => {
    const bindings = isolatedEnv();
    const table = `barrier_mid_${crypto.randomUUID().replaceAll("-", "")}`;
    await bindings.DB.exec(`CREATE TABLE ${table} (value TEXT)`);
    const guarded = guardedStorageEnv(bindings);

    // 1. Read-only D1 quota error on GET /api/v1/me must not poison WriteBarrier drain
    const readQuotaCtx = context({
      DataService: {
        async identityMe() {
          throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.");
        },
      },
    });
    const quotaRes = await fetchWorker("/api/v1/me", bindings, readQuotaCtx.ctx, {
      headers: { authorization: "Bearer test-token" },
    });
    expect(quotaRes.status).toBe(503);
    await Promise.all(readQuotaCtx.pending);
    expect(await (await control(bindings, "close")).json()).toMatchObject({
      closed: true,
      drained: true,
      outstanding: [],
    });
    await control(bindings, "open");

    // 2. Mid-flight barrier close before inner guarded write returns 503 maintenance and drains cleanly
    const midCloseCtx = context({
      DataService: {
        async identityRevoke() {
          await control(bindings, "close");
          await guarded.DB.prepare(`DELETE FROM ${table}`).run();
          return false;
        },
      },
    });
    const midCloseRes = await fetchWorker("/api/v1/sessions/current", bindings, midCloseCtx.ctx, {
      method: "DELETE",
      headers: { authorization: "Bearer test-token" },
    });
    expect(midCloseRes.status).toBe(503);
    await expect(midCloseRes.json()).resolves.toMatchObject({ error: { code: "maintenance" } });
    await Promise.all(midCloseCtx.pending);
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true, outstanding: [] });
    await control(bindings, "open");

    // 3. Mid-flight barrier close inside ContentService and scheduled releases outer tickets cleanly
    const contentState = {
      exports: {
        DataService: {
          async contentGetTarget() {
            await control(bindings, "close");
            await guarded.DB.prepare(`DELETE FROM ${table}`).run();
            return null;
          },
        },
      },
    } as unknown as DurableObjectState;
    const contentService = new ContentService(contentState, bindings);
    const contentRes = await contentService.fetch(
      new Request("https://content-service/run", {
        method: "POST",
        body: JSON.stringify({ submissionId: "s-mid-close" }),
      }),
    );
    expect(contentRes.status).toBe(503);
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true, outstanding: [] });
    await control(bindings, "open");

    const schedCtx = context({
      DataService: {
        async findDueSubmissions() {
          await control(bindings, "close");
          await guarded.DB.prepare(`DELETE FROM ${table}`).run();
          return [];
        },
      },
    });
    const schedEvent = {
      scheduledTime: Date.UTC(2026, 0, 1, 1, 0),
      cron: "0 * * * *",
      noRetry() {},
    } as ScheduledController;
    worker.scheduled(schedEvent, bindings, schedCtx.ctx);
    await Promise.all(schedCtx.pending);
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true, outstanding: [] });
    await control(bindings, "open");

    // 4. Aborted/oversized stageStream cleans up R2 key and leaves zero leaked WriteBarrier tickets
    const { stageStream } = await import("../src/data/streaming-staging");
    const brokenStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(128));
        throw new Error("client disconnected mid-upload");
      },
    });
    await expect(stageStream(guarded.R2, brokenStream, 1024, 1024)).rejects.toThrow("client disconnected mid-upload");
    const leftover = await bindings.R2.list({ prefix: "tmp/uploads/" });
    expect(leftover.objects).toHaveLength(0);
    expect(await (await control(bindings, "close")).json()).toMatchObject({
      closed: true,
      drained: true,
      outstanding: [],
    });
    await control(bindings, "open");
    await bindings.DB.exec(`DROP TABLE ${table}`);
  });
});
