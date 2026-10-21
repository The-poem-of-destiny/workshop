import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";
import type { Env } from "../src/env";
import { applySchema } from "./support/schema";

const bindings = env as unknown as Env;
const sha = "abcdef0123456789";
const now = "2026-10-21T00:00:00.000Z";

beforeAll(async () => {
  await applySchema(bindings.DB);
});

beforeEach(async () => {
  await bindings.DB.exec("DELETE FROM site_settings;");
  await bindings.DB.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('client_channels', ?, ?)")
    .bind(
      JSON.stringify({
        stable: { revision: sha, version: "1.0.0", publishedAt: now },
        staging: { revision: sha, version: "1.1.0-rc.1", publishedAt: now },
      }),
      now,
    )
    .run();
  await bindings.R2.put(`client/v/${sha}/index.js`, "globalThis.CreativeWorkshop={version:'1.0.0'};");
  await bindings.R2.put("client/stable/index.js", "globalThis.CreativeWorkshop={version:'1.0.0'};");
  await bindings.R2.put("client/staging/index.js", "globalThis.CreativeWorkshop={version:'1.1.0-rc.1'};");
});

describe("client distribution", () => {
  it("serves versioned artifacts as immutable and stable pointers as revalidating", async () => {
    const versioned = await app.request(
      `/client/v/${sha}/index.js`,
      {
        headers: { origin: "https://tavern.example" },
      },
      bindings,
    );
    expect(versioned.status).toBe(200);
    expect(versioned.headers.get("cache-control")).toContain("immutable");
    expect(versioned.headers.get("cache-tag")).toBe(`client:v:${sha}`);
    expect(versioned.headers.get("access-control-allow-origin")).toBe("*");
    await expect(versioned.text()).resolves.toContain("CreativeWorkshop");

    const stable = await app.request("/client/stable/index.js", undefined, bindings);
    expect(stable.status).toBe(200);
    expect(stable.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(stable.headers.get("cloudflare-cdn-cache-control")).toBe("public, max-age=300");
    expect(stable.headers.get("cache-tag")).toBe("client:stable");

    for (const channel of ["other", "__proto__", "constructor"]) {
      expect((await app.request(`/client/${channel}/index.js`, undefined, bindings)).status).toBe(404);
      expect((await app.request(`/client/version?channel=${channel}`, undefined, bindings)).status).toBe(404);
    }
  });

  it("serves a one-time legacy shim pointing at the stable client", async () => {
    const response = await app.request("/test-dist/CreativeWorkshop/index.js", undefined, bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    await expect(response.text()).resolves.toContain("/client/stable/index.js");
  });

  it("serves pinned checker bundles immutably and rejects unknown files", async () => {
    const checkerSha = "1234567890abcdef";
    await bindings.R2.put(`checker/v/${checkerSha}/browser-checker.js`, "globalThis.PoemEjsChecker={};");
    await bindings.R2.put(`checker/v/${checkerSha}/NOTICES.txt`, "notices");
    const response = await app.request(`/client/checker/v/${checkerSha}/browser-checker.js`, undefined, bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("cache-tag")).toBe(`checker:v:${checkerSha}`);
    await expect(response.text()).resolves.toContain("PoemEjsChecker");
    const notices = await app.request(`/client/checker/v/${checkerSha}/NOTICES.txt`, undefined, bindings);
    expect(notices.status).toBe(200);
    await expect(notices.text()).resolves.toBe("notices");
    expect((await app.request(`/client/checker/v/${checkerSha}/..%2Fsecret`, undefined, bindings)).status).toBe(404);
    expect((await app.request("/client/checker/v/nothex/browser-checker.js", undefined, bindings)).status).toBe(404);
  });

  it("returns channel records and enforces exact version compatibility", async () => {
    const version = await app.request("/client/version?channel=staging", undefined, bindings);
    expect(version.status).toBe(200);
    await expect(version.json()).resolves.toMatchObject({
      channel: "staging",
      revision: sha,
      version: "1.1.0-rc.1",
    });

    const exact = await app.request(
      `/api/v1/client/compatibility?version=1.0.0`,
      {
        headers: { origin: "https://tavern.example" },
      },
      bindings,
    );
    expect(exact.headers.get("access-control-allow-origin")).toBe("*");
    await expect(exact.json()).resolves.toMatchObject({ compatible: true, required: "1.0.0" });
    expect((await app.request("/api/v1/client/compatibility?channel=constructor", undefined, bindings)).status).toBe(
      404,
    );

    for (const query of ["version=1.0.1", "version=0.9.0", ""]) {
      const response = await app.request(`/api/v1/client/compatibility?${query}`, undefined, bindings);
      await expect(response.json()).resolves.toMatchObject({ compatible: false, required: "1.0.0" });
    }
  });

  it("bootstraps when no channel record exists", async () => {
    await bindings.DB.exec("DELETE FROM site_settings;");
    const response = await app.request("/api/v1/client/compatibility?version=anything", undefined, bindings);
    await expect(response.json()).resolves.toMatchObject({ compatible: true, bootstrap: true });
  });
});
