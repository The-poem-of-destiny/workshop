import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import type { Env } from "../src/env";
import { applySchema } from "./support/schema";

const bindings = env as unknown as Env;
const ORIGIN = "https://workshop.test";
const GUILD = "123456789012345678";

async function s256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function mockDiscord(guildId = GUILD) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "access-token" });
    if (url.endsWith("/users/@me")) {
      return Response.json({ id: "discord-user", username: "tester", global_name: "Tester", avatar: null });
    }
    if (url.endsWith("/users/@me/guilds")) return Response.json([{ id: guildId }]);
    throw new Error(`unexpected fetch ${url}`);
  }));
}

async function createFlow(body: unknown) {
  return app.request("/api/v1/auth/flows", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  }, bindings);
}

async function callback(state: string) {
  return app.request(`/api/v1/auth/callback?state=${encodeURIComponent(state)}&code=code`, undefined, bindings);
}

beforeAll(async () => {
  await applySchema(bindings.DB);
  Object.assign(bindings, {
    ALLOWED_ORIGINS: ORIGIN,
    PUBLIC_ORIGIN: ORIGIN,
    DISCORD_CLIENT_ID: "client-id",
    DISCORD_CLIENT_SECRET: "client-secret",
    DISCORD_ALLOWED_GUILD_IDS: GUILD,
  });
});

beforeEach(async () => {
  await bindings.DB.exec("DELETE FROM oauth_flows; DELETE FROM sessions; DELETE FROM users;");
  mockDiscord();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OAuth flows", () => {
  it("completes an embed login with an iframe verifier", async () => {
    const verifier = "a".repeat(64);
    const created = await createFlow({ mode: "embed", codeChallenge: await s256(verifier) });
    expect(created.status).toBe(201);
    const flow = await created.json() as { id: string; state: string; url: string; mode: string };
    expect(flow.mode).toBe("embed");
    expect(flow.url).toContain("discord.com/oauth2/authorize");

    const done = await callback(flow.state);
    expect(done.status).toBe(200);
    const html = await done.text();
    const code = /"code":"([^"]+)"/.exec(html)?.[1];
    expect(code).toBeTruthy();

    const status = await app.request(`/api/v1/auth/flows/${flow.id}`, undefined, bindings);
    await expect(status.json()).resolves.toMatchObject({ status: "authorized" });

    const redeemed = await app.request(`/api/v1/auth/flows/${flow.id}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier }),
    }, bindings);
    expect(redeemed.status).toBe(200);
    const session = await redeemed.json() as { token: string; user: { id: string } };
    expect(session.user.id).toBe("discord-user");
    const me = await app.request("/api/v1/me", {
      headers: { authorization: `Bearer ${session.token}` },
    }, bindings);
    expect(me.status).toBe(200);

    const replay = await app.request(`/api/v1/auth/flows/${flow.id}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier }),
    }, bindings);
    expect(replay.status).toBe(409);
  });

  it("completes a device flow and rejects wrong device secrets", async () => {
    const created = await createFlow({ mode: "device" });
    const flow = await created.json() as { id: string; state: string; deviceCode: string };
    expect(flow.deviceCode).toEqual(expect.any(String));
    expect((await callback(flow.state)).status).toBe(200);

    const wrong = await app.request(`/api/v1/auth/flows/${flow.id}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: "wrong-wrong-wrong-wrong" }),
    }, bindings);
    expect(wrong.status).toBe(403);

    const redeemed = await app.request(`/api/v1/auth/flows/${flow.id}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: flow.deviceCode }),
    }, bindings);
    expect(redeemed.status).toBe(200);
    await expect(redeemed.json()).resolves.toMatchObject({ user: { id: "discord-user" } });
  });

  it("creates a browser session and rejects callback replay", async () => {
    const created = await createFlow({ mode: "browser" });
    const flow = await created.json() as { state: string };
    const done = await callback(flow.state);
    expect(done.status).toBe(200);
    const html = await done.text();
    const token = /"token":"([^"]+)"/.exec(html)?.[1];
    expect(token).toBeTruthy();
    expect((await app.request("/api/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    }, bindings)).status).toBe(200);
    expect((await callback(flow.state)).status).toBe(400);
  });

  it("rejects a Discord account outside the allowed guild", async () => {
    mockDiscord("323456789012345678");
    const created = await createFlow({ mode: "device" });
    const flow = await created.json() as { id: string; state: string };
    const done = await callback(flow.state);
    expect(done.status).toBe(400);
    const status = await app.request(`/api/v1/auth/flows/${flow.id}`, undefined, bindings);
    await expect(status.json()).resolves.toMatchObject({ status: "pending", error: "你的账号不在允许的 Discord 服务器中" });
  });

  it("only allows configured origins for auth and CORS preflight", async () => {
    const disallowed = await app.request("/api/v1/auth/flows", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ mode: "browser" }),
    }, bindings);
    expect(disallowed.status).toBe(403);

    const preflight = await app.request("/api/v1/projects", {
      method: "OPTIONS",
      headers: { origin: ORIGIN, "access-control-request-method": "GET" },
    }, bindings);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);

    const denied = await app.request("/api/v1/projects", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    }, bindings);
    expect(denied.status).toBe(403);
  });
});
