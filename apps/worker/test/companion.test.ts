import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DataEnv } from "../src/data/env";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const base = "/api/v1/companion-scripts/character-manager";
const input = { displayName: "角色管理库", downloadUrl: "https://example.org/character-manager/v0.3.4.js" };

async function put(version: string, token: string | null = "owner-token", body: unknown = input) {
  return SELF.fetch(new URL(`${base}/versions/${version}`, "https://workshop.test").toString(), {
    method: "PUT",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

beforeAll(() => applySchema(bindings.DB));
beforeEach(async () => {
  await bindings.DB.exec(
    "DELETE FROM audit_events; DELETE FROM site_settings; DELETE FROM sessions; DELETE FROM users;",
  );
  for (const role of ["owner", "reviewer", "member"]) {
    await bindings.DB.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").bind(role, role, role).run();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${role}-token`));
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await bindings.DB.prepare(`INSERT INTO sessions (token_hash, user_id, session_version, expires_at)
      VALUES (?, ?, 1, '2099-01-01T00:00:00.000Z')`)
      .bind(hash, role)
      .run();
  }
});

describe("companion release registration", () => {
  it("requires a current owner session and does not grant reviewer publishing", async () => {
    expect((await put("0.3.4", null)).status).toBe(401);
    expect((await put("0.3.4", "invalid")).status).toBe(401);
    expect((await put("0.3.4", "member-token")).status).toBe(403);
    expect((await put("0.3.4", "reviewer-token")).status).toBe(403);
    await bindings.DB.prepare("UPDATE users SET role = 'member' WHERE id = 'owner'").run();
    expect((await put("0.3.4")).status).toBe(403);
    expect(
      await bindings.DB.prepare("SELECT COUNT(*) AS n FROM site_settings WHERE key LIKE 'companion:%'").first("n"),
    ).toBe(0);
  });

  it("rejects expired and revoked owner sessions", async () => {
    await bindings.DB.prepare(
      "UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'owner'",
    ).run();
    expect((await put("0.3.4")).status).toBe(401);
    await bindings.DB.prepare(
      "UPDATE sessions SET expires_at = '2099-01-01T00:00:00.000Z', revoked_at = CURRENT_TIMESTAMP WHERE user_id = 'owner'",
    ).run();
    expect((await put("0.3.4")).status).toBe(401);
  });

  it("rejects invalid identifiers, payloads, non-HTTPS and credential URLs without writes", async () => {
    for (const body of [
      null,
      {},
      { ...input, displayName: " " },
      { ...input, downloadUrl: "javascript:alert(1)" },
      { ...input, downloadUrl: "https://secret:token@example.org/a.js" },
      { ...input, downloadUrl: "http://example.org/a.js" },
      { ...input, downloadUrl: "not a URL" },
      { ...input, script: "alert(1)" },
    ]) {
      expect((await put("0.3.4", "owner-token", body)).status).toBe(400);
    }
    expect((await put("bad%20version")).status).toBe(400);
    const malformed = await SELF.fetch(new URL(`${base}/versions/0.3.4`, "https://workshop.test").toString(), {
      method: "PUT",
      headers: { authorization: "Bearer owner-token" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(
      await bindings.DB.prepare("SELECT COUNT(*) AS n FROM site_settings WHERE key LIKE 'companion:%'").first("n"),
    ).toBe(0);
  });

  it("publishes and anonymously reads an exact immutable release plus latest", async () => {
    expect((await SELF.fetch(new URL(base, "https://workshop.test").toString(), undefined)).status).toBe(404);
    const response = await put("0.3.4");
    expect(response.status).toBe(201);
    const record = await response.json();
    expect(record).toMatchObject({ ...input, scriptId: "character-manager", version: "0.3.4" });
    expect(record).not.toHaveProperty("actorId");
    const exact = await SELF.fetch(new URL(`${base}/versions/0.3.4`, "https://workshop.test").toString(), undefined);
    expect(exact.headers.get("cache-control")).toContain("no-store");
    expect(await exact.json()).toEqual(record);
    expect(await (await SELF.fetch(new URL(base, "https://workshop.test").toString(), undefined)).json()).toEqual(
      record,
    );
    expect(
      (await SELF.fetch(new URL(`${base}/versions/unknown`, "https://workshop.test").toString(), undefined)).status,
    ).toBe(404);
    expect((await put("0.3.4")).status).toBe(200);
    expect(
      (await put("0.3.4", "owner-token", { ...input, downloadUrl: "https://example.org/changed.js" })).status,
    ).toBe(409);
    expect(
      await bindings.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'companion.publish'").first("n"),
    ).toBe(1);
    expect(
      await (await SELF.fetch(new URL(`${base}/versions/0.3.4`, "https://workshop.test").toString(), undefined)).json(),
    ).toEqual(record);
  });

  it("keeps latest at the last new registration when an older version is replayed", async () => {
    await put("0.3.4");
    expect((await put("0.3.5")).status).toBe(201);
    expect((await put("0.3.4")).status).toBe(200);
    expect(await (await SELF.fetch(new URL(base, "https://workshop.test").toString(), undefined)).json()).toMatchObject(
      { version: "0.3.5" },
    );
    expect(
      await bindings.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'companion.publish'").first("n"),
    ).toBe(2);
  });

  it("deduplicates simultaneous identical registrations and keeps one audit record", async () => {
    const responses = await Promise.all([put("0.3.4"), put("0.3.4")]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    expect(
      await bindings.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'companion.publish'").first("n"),
    ).toBe(1);
  });

  it("commits only one competing immutable version and its corresponding latest record", async () => {
    const responses = await Promise.all([
      put("0.3.4"),
      put("0.3.4", "owner-token", { ...input, downloadUrl: "https://example.org/other.js" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const exact = await (
      await SELF.fetch(new URL(`${base}/versions/0.3.4`, "https://workshop.test").toString(), undefined)
    ).json();
    expect(await (await SELF.fetch(new URL(base, "https://workshop.test").toString(), undefined)).json()).toEqual(
      exact,
    );
    expect(
      await bindings.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'companion.publish'").first("n"),
    ).toBe(1);
  });
});
