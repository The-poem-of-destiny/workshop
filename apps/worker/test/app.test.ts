import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import type { Env } from "../src/env";

const env = {
  DB: {},
  R2: {},
  ASSETS: {},
  APP_VERSION: "test",
} as unknown as Env;

describe("worker skeleton", () => {
  it("returns a valid health response", async () => {
    const response = await app.request("/api/v1/health", undefined, env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "workshop",
      version: "test",
      bindings: { db: true, r2: true, assets: true },
    });
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const response = await app.request("/api/v1/unknown", undefined, env);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Not found" },
    });
  });

  it("sets security headers on API responses", async () => {
    const response = await app.request("/api/v1/unknown", undefined, env);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const unauthorized = await app.request("/api/v1/me", undefined, env);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not swallow API 404 into the text fallback", async () => {
    const response = await app.request("/api", undefined, env);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("keeps non-API fallback as text", async () => {
    const response = await app.request("/missing", undefined, env);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/plain");
  });
});
