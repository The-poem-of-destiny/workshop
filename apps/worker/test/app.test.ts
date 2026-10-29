import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("worker skeleton", () => {
  it("returns a valid health response", async () => {
    const response = await SELF.fetch("https://workshop.test/api/v1/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "workshop",
      version: "test",
      bindings: { db: true, r2: true, assets: true },
    });
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const response = await SELF.fetch("https://workshop.test/api/v1/unknown");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Not found" },
    });
  });

  it("sets security headers on API responses", async () => {
    const response = await SELF.fetch("https://workshop.test/api/v1/unknown");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const unauthorized = await SELF.fetch("https://workshop.test/api/v1/me");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not swallow API 404 into the text fallback", async () => {
    const response = await SELF.fetch("https://workshop.test/api");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("keeps non-API fallback as text", async () => {
    const response = await SELF.fetch("https://workshop.test/missing");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/plain");
  });
});
