import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { DataEnv } from "../src/data/env";
import { guardedStorageEnv } from "../src/data/storage-guard";
import type { Env } from "../src/env";
import { barrierControl } from "../src/write-barrier";

const route = vi.hoisted(() => vi.fn());
vi.mock("../src/app", () => ({ app: { fetch: route } }));

import worker from "../src/index";

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

describe("maintenance runtime boundaries", () => {
  it("serves a standalone maintenance document while keeping APIs and controls protected", async () => {
    const bindings = isolatedEnv();
    expect((await control(bindings, "close")).status).toBe(200);
    const { ctx, pending } = context();
    const fetch = (path: string, init?: RequestInit) =>
      worker.fetch(
        new Request(`https://example.test${path}`, init) as Parameters<typeof worker.fetch>[0],
        bindings,
        ctx,
      );

    const document = await fetch("/", { headers: { accept: "text/html", "sec-fetch-dest": "document" } });
    expect(document.status).toBe(503);
    expect(document.headers.get("content-type")).toContain("text/html");
    expect(document.headers.get("cache-control")).toContain("no-store");
    const html = await document.text();
    expect(html).toMatch(/维护/);
    expect(html).toMatch(/稍后重试/);
    expect(html).not.toMatch(/<script\b/i);

    for (const path of ["/api/v1/home", "/api/v1/assets/private", "/client/stable/index.js"]) {
      const response = await fetch(path, { headers: { accept: "text/html" } });
      expect(response.status, path).toBe(503);
      expect(response.headers.get("content-type"), path).toContain("application/json");
      expect(await response.json(), path).toMatchObject({ error: { code: "maintenance" } });
    }

    const unauthorized = await fetch("/api/v1/maintenance");
    expect(unauthorized.status).toBe(401);
    const authorized = await fetch("/api/v1/maintenance", {
      headers: { authorization: "Bearer test-operator-secret" },
    });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({ closed: true, drained: true });
    await Promise.all(pending);
  });

  it("serves built JavaScript without consulting the barrier or business handlers", async () => {
    const bindings = isolatedEnv();
    const assets = bindings.ASSETS!;
    const shell = await assets.fetch(new Request("https://example.test/"));
    const html = await shell.text();
    const script = html.match(/<script[^>]+src="([^"]+\.js)"/i)?.[1];
    expect(script).toBeDefined();

    const guardedBindings = {
      ...bindings,
      WRITE_BARRIER: {
        idFromName() {
          throw new Error("Static assets must not consult the barrier");
        },
      } as unknown as Env["WRITE_BARRIER"],
    };
    route.mockClear();
    const { ctx, pending } = context();
    const response = await worker.fetch(
      new Request(new URL(script!, "https://example.test")) as Parameters<typeof worker.fetch>[0],
      guardedBindings,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/(?:javascript|ecmascript)/i);
    const original = await assets.fetch(new Request(new URL(script!, "https://example.test")));
    expect(await response.text()).toBe(await original.text());
    expect(route).not.toHaveBeenCalled();
    await Promise.all(pending);
  });

  it("drains only after the response stream and nested background work complete", async () => {
    const bindings = isolatedEnv();
    const first = deferred();
    const nested = deferred();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    route.mockImplementationOnce((_request: Request, _env: Env, ctx: ExecutionContext) => {
      ctx.waitUntil(
        first.promise.then(() => {
          ctx.waitUntil(nested.promise);
        }),
      );
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
          },
        }),
      );
    });
    const { ctx, pending } = context();
    const response = await worker.fetch(
      new Request("https://example.test/runtime-test") as Parameters<typeof worker.fetch>[0],
      bindings,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(await (await control(bindings, "close")).json()).toMatchObject({ closed: true, drained: false });
    expect(
      (
        await worker.fetch(
          new Request("https://example.test/runtime-test") as Parameters<typeof worker.fetch>[0],
          bindings,
          ctx,
        )
      ).status,
    ).toBe(503);
    expect(route).toHaveBeenCalledTimes(1);

    first.resolve();
    await first.promise;
    stream.enqueue(new TextEncoder().encode("complete"));
    stream.close();
    expect(await response.text()).toBe("complete");
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: false });
    expect((await control(bindings, "open")).status).toBe(409);
    nested.resolve();
    await Promise.all(pending);
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true });
    expect((await control(bindings, "open")).status).toBe(200);
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
    await expect(guarded.DB.batch([guarded.DB.prepare(`DELETE FROM ${table}`)])).rejects.toThrow(
      "Maintenance barrier closed or unavailable",
    );
    await expect(guarded.R2.put(key, "blocked")).rejects.toThrow("Maintenance barrier closed or unavailable");
    await expect(guarded.R2.delete(key)).rejects.toThrow("Maintenance barrier closed or unavailable");
    await expect(multipart.uploadPart(1, new Uint8Array([1]))).rejects.toThrow(
      "Maintenance barrier closed or unavailable",
    );
    expect(await guarded.DB.prepare(`SELECT value FROM ${table}`).all()).toMatchObject({
      results: [{ value: "original" }],
    });
    expect(await (await guarded.R2.get(key))?.text()).toBe("original");
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true });
    await control(bindings, "open");
    await multipart.abort();
    await bindings.R2.delete(key);
    await bindings.DB.exec(`DROP TABLE ${table}`);
  });
});
