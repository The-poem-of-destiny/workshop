import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CachedReads, type ReadProps } from "../src/data/cached-reads";
import type { DataEnv } from "../src/data/env";
import { publicResponse } from "../src/http/public-response";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
let version: string;

beforeAll(async () => applySchema(bindings.DB));
beforeEach(async () => {
  version = crypto.randomUUID();
  await bindings.DB.exec(`
    UPDATE projects SET working_version_id = NULL, published_version_id = NULL, published_cover_asset_id = NULL;
    DELETE FROM project_versions;
    DELETE FROM projects;
    DELETE FROM users;
  `);
  await bindings.DB.prepare("INSERT INTO users (id, username) VALUES ('cache-author', 'cache-author')").run();
  await bindings.DB.prepare(`INSERT INTO projects
    (id, author_id, visibility, published_at, updated_at)
    VALUES ('cache-project', 'cache-author', 'public', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run();
  await publishTitle("Original");
});
afterEach(() => vi.restoreAllMocks());

async function publishTitle(title: string): Promise<void> {
  const id = crypto.randomUUID();
  await bindings.DB.batch([
    bindings.DB.prepare(`INSERT INTO project_versions
      (id, project_id, version_no, title, created_by, entry_index)
      VALUES (?, 'cache-project', (SELECT COALESCE(MAX(version_no), 0) + 1 FROM project_versions WHERE project_id = 'cache-project'), ?, 'cache-author', '{"schemaVersion":1,"entries":[]}')`).bind(
      id,
      title,
    ),
    bindings.DB.prepare("UPDATE projects SET published_version_id = ? WHERE id = 'cache-project'").bind(id),
  ]);
}

async function read(
  path: string,
  options: {
    method?: "GET" | "HEAD";
    props?: ReadProps;
    settings?: Partial<DataEnv>;
  } = {},
): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    props: options.props ?? { kind: "public" },
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  } as unknown as ExecutionContext;
  const worker = new CachedReads(ctx, { ...bindings, VERSION_METADATA: { id: version }, ...options.settings });
  const response = await worker.fetch(
    new Request(`https://cached.workshop.invalid${path}`, { method: options.method }),
  );
  await Promise.all(pending);
  return response;
}

const project = "/public/v1/api/v1/projects/cache-project";
function exposed(response: Response, path = "/api/v1/projects/cache-project"): Response {
  return publicResponse(response, new Request(`https://workshop.test${path}`));
}
function maxAge(response: Response): number {
  return Number(/(?:^|,\s*)max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1]);
}

describe("Cache API read behavior", () => {
  it("serves a real hit and applies the remaining application freshness deadline", async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    const first = exposed(await read(project));
    expect(maxAge(first)).toBe(60);
    expect(await first.json()).toMatchObject({ title: "Original" });
    await publishTitle("Changed");
    clock.mockReturnValue(start + 20_000);
    const hit = exposed(await read(project));
    expect(await hit.json()).toMatchObject({ title: "Original" });
    expect(maxAge(hit)).toBe(40);
    // This advances the application clock, not the Cache API's platform clock.
    clock.mockReturnValue(start + 61_000);
    const afterDeadline = exposed(await read(project));
    expect(await afterDeadline.json()).toMatchObject({ title: "Changed" });
    expect(maxAge(afterDeadline)).toBe(60);
  });

  it("keeps query variants and Worker versions isolated", async () => {
    const first = await read("/public/v1/api/v1/projects?search=Original");
    expect((await first.json<{ items: unknown[] }>()).items).toHaveLength(1);
    const different = await read("/public/v1/api/v1/projects?search=Missing");
    expect((await different.json<{ items: unknown[] }>()).items).toHaveLength(0);
    await publishTitle("Changed");
    expect(await (await read(project)).json()).toMatchObject({ title: "Changed" });
    await publishTitle("New version");
    expect(await (await read(project)).json()).toMatchObject({ title: "Changed" });
    version = crypto.randomUUID();
    expect(await (await read(project)).json()).toMatchObject({ title: "New version" });
  });

  it("shares complete GET representations with HEAD in both directions", async () => {
    const head = await read(project, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    await publishTitle("Changed");
    expect(await (await read(project)).json()).toMatchObject({ title: "Original" });
    const secondHead = await read(project, { method: "HEAD" });
    expect(secondHead.status).toBe(200);
    expect(await secondHead.text()).toBe("");
  });

  it.each([
    ["/api/v1/projects", 60],
    ["/api/v1/recommendations", 60],
    ["/api/v1/projects/discovery", 60],
    ["/api/v1/site", 300],
  ] as const)("uses the configured default class for %s", async (path, seconds) => {
    const response = exposed(await read(`/public/v1${path}`), path);
    expect(response.status).toBe(200);
    expect(maxAge(response)).toBeGreaterThanOrEqual(seconds - 1);
    expect(maxAge(response)).toBeLessThanOrEqual(seconds);
  });

  it("applies separate category settings and bypasses storage without a version identity", async () => {
    const settings = { CACHE_TTL_PUBLIC_SECONDS: "23", CACHE_TTL_REFERENCE_SECONDS: "123" };
    const projectResponse = exposed(await read(project, { settings }));
    expect(maxAge(projectResponse)).toBeGreaterThanOrEqual(22);
    expect(maxAge(projectResponse)).toBeLessThanOrEqual(23);
    const site = exposed(await read("/public/v1/api/v1/site", { settings }), "/api/v1/site");
    expect(maxAge(site)).toBeGreaterThanOrEqual(122);
    expect(maxAge(site)).toBeLessThanOrEqual(123);
    const unversioned = { VERSION_METADATA: undefined };
    expect(await (await read(project, { settings: unversioned })).json()).toMatchObject({ title: "Original" });
    await publishTitle("Changed");
    expect(await (await read(project, { settings: unversioned })).json()).toMatchObject({ title: "Changed" });
  });

  it("caches immutable internal objects by identity with their own TTL", async () => {
    const sha256 = "a".repeat(64);
    const identity = crypto.randomUUID();
    const r2Key = `test-cache/${identity}`;
    const props: ReadProps = { kind: "object", identity, r2Key, sha256 };
    const path = `/objects/v1/${identity}/${sha256}`;
    await bindings.R2.put(r2Key, "first object");
    const first = await read(path, { props });
    expect(first.headers.get("cache-control")).toContain("max-age=86400");
    expect(await first.text()).toBe("first object");
    await bindings.R2.put(r2Key, "new object");
    expect(await (await read(path, { props })).text()).toBe("first object");
    version = crypto.randomUUID();
    expect(await (await read(path, { props })).text()).toBe("new object");
  });

  it.each(["0", "-1", "invalid", "31536001"])("disables caching for TTL %s", async (ttl) => {
    const settings = { CACHE_TTL_PUBLIC_SECONDS: ttl };
    const first = exposed(await read(project, { settings }));
    expect(first.headers.get("cache-control")).toContain("no-store");
    expect(await first.json()).toMatchObject({ title: "Original" });
    await publishTitle("Changed");
    const second = exposed(await read(project, { settings }));
    expect(second.headers.get("cache-control")).toContain("no-store");
    expect(await second.json()).toMatchObject({ title: "Changed" });
  });

  it("does not cache errors and retains immutable asset semantics", async () => {
    const sha = crypto.randomUUID().replaceAll("-", "");
    const path = `/client/v/${sha}/index.js`;
    const internal = `/public/v1${path}`;
    const missing = exposed(await read(internal), path);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toContain("no-store");
    await bindings.R2.put(`client/v/${sha}/index.js`, "first version");
    const first = exposed(await read(internal), path);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("immutable");
    expect(maxAge(first)).toBeGreaterThanOrEqual(31_535_999);
    expect(first.headers.get("access-control-allow-origin")).toBe("*");
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();
    expect(await first.text()).toBe("first version");
    await bindings.R2.put(`client/v/${sha}/index.js`, "changed version");
    expect(await (await read(internal)).text()).toBe("first version");
    const conditional = publicResponse(
      await read(internal),
      new Request(`https://workshop.test${path}`, { headers: { "if-none-match": etag! } }),
    );
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("etag")).toBe(etag);
    expect(conditional.headers.get("access-control-allow-origin")).toBe("*");
  });

  it.each(["0", "invalid"])("preserves conditional versioned client and checker responses with TTL %s", async (ttl) => {
    const sha = crypto.randomUUID().replaceAll("-", "");
    const settings = { CACHE_TTL_IMMUTABLE_SECONDS: ttl };
    for (const [path, key] of [
      [`/client/v/${sha}/index.js`, `client/v/${sha}/index.js`],
      [`/client/checker/v/${sha}/browser-checker.js`, `checker/v/${sha}/browser-checker.js`],
    ] as const) {
      await bindings.R2.put(key, "versioned asset");
      const initial = exposed(await read(`/public/v1${path}`, { settings }), path);
      expect(initial.status).toBe(200);
      expect(initial.headers.get("cache-control")).toContain("no-store");
      const etag = initial.headers.get("etag");
      expect(etag).not.toBeNull();
      await initial.text();
      for (const method of ["GET", "HEAD"] as const) {
        const request = new Request(`https://workshop.test${path}`, {
          method,
          headers: { "if-none-match": etag! },
        });
        const response = publicResponse(await read(`/public/v1${path}`, { method, settings }), request);
        expect(response.status, `${path} ${method}`).toBe(304);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(response.headers.get("etag")).toBe(etag);
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        expect(await response.text()).toBe("");
      }
    }
  });
});
