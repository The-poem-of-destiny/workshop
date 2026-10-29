import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DataEnv } from "../src/data/env";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
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
  it("serves versioned artifacts immutably and channel pointers without caching", async () => {
    const versioned = await SELF.fetch(new URL(`/client/v/${sha}/index.js`, "https://workshop.test").toString(), {
      headers: { origin: "https://tavern.example" },
    });
    expect(versioned.status).toBe(200);
    expect(versioned.headers.get("cache-control")).toContain("immutable");
    expect(versioned.headers.get("cache-tag")).toBe(`client:v:${sha}`);
    expect(versioned.headers.get("access-control-allow-origin")).toBe("*");
    await expect(versioned.text()).resolves.toContain("CreativeWorkshop");

    const stable = await SELF.fetch(new URL("/client/stable/index.js", "https://workshop.test").toString(), undefined);
    expect(stable.status).toBe(200);
    expect(stable.headers.get("cache-control")).toBe("no-store");
    expect(stable.headers.get("cloudflare-cdn-cache-control")).toBeNull();
    expect(stable.headers.get("cache-tag")).toBeNull();

    for (const channel of ["other", "__proto__", "constructor"]) {
      expect(
        (await SELF.fetch(new URL(`/client/${channel}/index.js`, "https://workshop.test").toString(), undefined))
          .status,
      ).toBe(404);
      const invalidVersion = await SELF.fetch(
        new URL(`/api/v1/client/version?channel=${channel}`, "https://workshop.test").toString(),
        undefined,
      );
      expect(invalidVersion.status).toBe(404);
      expect(invalidVersion.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("serves a one-time legacy shim pointing at the stable client", async () => {
    const response = await SELF.fetch(
      new URL("/test-dist/CreativeWorkshop/index.js", "https://workshop.test").toString(),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    await expect(response.text()).resolves.toContain("/client/stable/index.js");
  });

  it("serves pinned checker bundles immutably and rejects unknown files", async () => {
    const checkerSha = "1234567890abcdef";
    await bindings.R2.put(`checker/v/${checkerSha}/browser-checker.js`, "globalThis.PoemEjsChecker={};");
    await bindings.R2.put(`checker/v/${checkerSha}/NOTICES.txt`, "notices");
    const response = await SELF.fetch(
      new URL(`/client/checker/v/${checkerSha}/browser-checker.js`, "https://workshop.test").toString(),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("cache-tag")).toBe(`checker:v:${checkerSha}`);
    await expect(response.text()).resolves.toContain("PoemEjsChecker");
    const notices = await SELF.fetch(
      new URL(`/client/checker/v/${checkerSha}/NOTICES.txt`, "https://workshop.test").toString(),
      undefined,
    );
    expect(notices.status).toBe(200);
    await expect(notices.text()).resolves.toBe("notices");
    expect(
      (
        await SELF.fetch(
          new URL(`/client/checker/v/${checkerSha}/..%2Fsecret`, "https://workshop.test").toString(),
          undefined,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch(
          new URL("/client/checker/v/nothex/browser-checker.js", "https://workshop.test").toString(),
          undefined,
        )
      ).status,
    ).toBe(404);
  });

  it("returns channel records and enforces exact version compatibility", async () => {
    const version = await SELF.fetch(
      new URL("/api/v1/client/version?channel=staging", "https://workshop.test").toString(),
      undefined,
    );
    expect(version.status).toBe(200);
    expect(version.headers.get("cache-control")).toBe("public, max-age=5, stale-if-error=0");
    await expect(version.json()).resolves.toMatchObject({
      channel: "staging",
      revision: sha,
      version: "1.1.0-rc.1",
    });

    const exact = await SELF.fetch(
      new URL(`/api/v1/client/compatibility?version=1.0.0`, "https://workshop.test").toString(),
      {
        headers: { origin: "https://tavern.example" },
      },
    );
    expect(exact.headers.get("access-control-allow-origin")).toBe("*");
    expect(exact.headers.get("cache-control")).toBe("public, max-age=5, stale-if-error=0");
    await expect(exact.json()).resolves.toMatchObject({ compatible: true, required: "1.0.0" });
    const invalid = await SELF.fetch(
      new URL("/api/v1/client/compatibility?channel=constructor", "https://workshop.test").toString(),
      undefined,
    );
    expect(invalid.status).toBe(404);
    expect(invalid.headers.get("cache-control")).toContain("no-store");

    for (const query of ["version=1.0.1", "version=0.9.0", ""]) {
      const response = await SELF.fetch(
        new URL(`/api/v1/client/compatibility?${query}`, "https://workshop.test").toString(),
        undefined,
      );
      expect(response.headers.get("cache-control")).toBe("public, max-age=5, stale-if-error=0");
      await expect(response.json()).resolves.toMatchObject({ compatible: false, required: "1.0.0" });
    }
  });

  it("returns distinct cacheable representations for channel and version parameters", async () => {
    const staging = await SELF.fetch(
      new URL("/api/v1/client/compatibility?channel=staging&version=1.1.0-rc.1", "https://workshop.test").toString(),
      undefined,
    );
    expect(staging.headers.get("cache-control")).toBe("public, max-age=5, stale-if-error=0");
    await expect(staging.json()).resolves.toMatchObject({
      channel: "staging",
      compatible: true,
      required: "1.1.0-rc.1",
    });

    const differentVersion = await SELF.fetch(
      new URL("/api/v1/client/compatibility?channel=staging&version=1.0.0", "https://workshop.test").toString(),
      undefined,
    );
    expect(differentVersion.headers.get("cache-control")).toBe("public, max-age=5, stale-if-error=0");
    await expect(differentVersion.json()).resolves.toMatchObject({
      channel: "staging",
      compatible: false,
      required: "1.1.0-rc.1",
    });
  });

  it("returns bootstrap without asserting install compatibility when no channel record exists", async () => {
    await bindings.DB.exec("DELETE FROM site_settings;");
    const response = await SELF.fetch(
      new URL("/api/v1/client/compatibility?version=anything", "https://workshop.test").toString(),
      undefined,
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      compatible: false,
      bootstrap: true,
      required: null,
      revision: null,
      reason: "channel_unavailable",
    });
    const version = await SELF.fetch(new URL("/api/v1/client/version", "https://workshop.test").toString(), undefined);
    expect(version.status).toBe(404);
    expect(version.headers.get("cache-control")).toContain("no-store");
  });
});
