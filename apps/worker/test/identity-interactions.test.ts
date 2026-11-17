import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DataEnv } from "../src/data/env";
import { identityMe } from "../src/data/identity-operations";
import { listAdminProjects } from "../src/storage/admin-directory";
import { getPublishedProject } from "../src/storage/projects";
import { hashSessionToken } from "../src/storage/session-hash";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const now = "2026-10-21T00:00:00.000Z";
const token = "identity-interactions-token";

async function tokenHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

beforeAll(async () => {
  await applySchema(bindings.DB);
});

beforeEach(async () => {
  await bindings.DB.exec(`
    DELETE FROM oauth_flows;
    DELETE FROM project_ratings;
    DELETE FROM project_subscriptions;
    DELETE FROM project_likes;
    DELETE FROM sessions;
    UPDATE projects SET working_version_id = NULL, published_version_id = NULL, published_cover_asset_id = NULL;
    DELETE FROM project_versions;
    DELETE FROM projects;
    DELETE FROM users;
  `);
  await bindings.DB.prepare(
    "INSERT INTO users (id, username, global_name, avatar, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'member', ?, ?)",
  )
    .bind("u1", "tester", "测试用户", "avatar-hash", now, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO projects (id, author_id, visibility, updated_at)
    VALUES ('p1', 'u1', 'public', ?)
  `)
    .bind(now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO project_versions (id, project_id, version_no, title, project_type, created_by)
    VALUES ('r1', 'p1', 1, '测试项目', '角色', 'u1')
  `).run();
  await bindings.DB.prepare("UPDATE projects SET published_version_id = 'r1' WHERE id = 'p1'").run();
  await bindings.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, 'u1', '2099-01-01T00:00:00.000Z')",
  )
    .bind(await tokenHash(token))
    .run();
});

const auth = { Authorization: `Bearer ${token}` };

async function request(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(new URL(path, "https://workshop.test").toString(), {
    ...init,
    headers: { ...auth, ...init?.headers },
  });
}

describe("identity and interactions", () => {
  it("requires a valid session and returns the me shape", async () => {
    const anonymous = await SELF.fetch(new URL("/api/v1/me", "https://workshop.test").toString(), undefined);
    expect(anonymous.status).toBe(401);
    const response = await request("/api/v1/me");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "u1",
        username: "tester",
        globalName: "测试用户",
        avatarUrl: "https://cdn.discordapp.com/avatars/u1/avatar-hash.png",
        role: "member",
      },
    });
  });

  it("revokes the current session immediately", async () => {
    expect((await request("/api/v1/sessions/current", { method: "DELETE" })).status).toBe(204);
    expect((await request("/api/v1/me")).status).toBe(401);
  });

  it("validates origins and exposes only flow status", async () => {
    const rejected = await SELF.fetch("https://workshop.test/api/v1/auth/flows", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ mode: "browser" }),
    });
    expect(rejected.status).toBe(403);
    const missing = await SELF.fetch("https://workshop.test/api/v1/auth/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "browser" }),
    });
    expect(missing.status).toBe(403);
    const created = await SELF.fetch("https://workshop.test/api/v1/auth/flows", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({ mode: "device" }),
    });
    expect(created.status).toBe(201);
    const flow = (await created.json()) as {
      id: string;
      state: string;
      url: string;
      expiresAt: string;
      deviceCode: string;
    };
    expect(flow.state).toEqual(expect.any(String));
    expect(flow.url).toContain("https://discord.com/oauth2/authorize");
    const rawCookie = created.headers.get("set-cookie") ?? "";
    const cookie = /cw_oauth_binding=([^;]+)/.exec(rawCookie)?.[0] ?? "";
    const unauthorized = await SELF.fetch(
      new URL(`/api/v1/auth/flows/${flow.id}`, "https://workshop.test").toString(),
      { headers: { cookie } },
    );
    expect(unauthorized.status).toBe(404);
    const status = await SELF.fetch(
      new URL(`/api/v1/auth/flows/${flow.id}?deviceCode=${flow.deviceCode}`, "https://workshop.test").toString(),
      { headers: { cookie } },
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({ status: "pending", expiresAt: flow.expiresAt });
  });

  it("uses HMAC session hashes when a secret is configured", async () => {
    const tokenValue = "hmac-session-token";
    await bindings.DB.prepare("DELETE FROM sessions").run();
    await bindings.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, 'u1', '2099-01-01T00:00:00.000Z')",
    )
      .bind(await hashSessionToken(tokenValue, "staging-secret"))
      .run();
    expect(
      (await identityMe({ ...bindings, SESSION_HASH_SECRET: "staging-secret" }, tokenValue, { kind: "me" })).ok,
    ).toBe(true);
    expect(
      (await identityMe({ ...bindings, SESSION_HASH_SECRET: "wrong-secret" }, tokenValue, { kind: "me" })).ok,
    ).toBe(false);
  });

  it("applies idempotent likes and subscriptions and keeps ratings private", async () => {
    expect((await request("/api/v1/me/likes/p1", { method: "PUT" })).status).toBe(204);
    expect((await request("/api/v1/me/likes/p1", { method: "PUT" })).status).toBe(204);
    expect((await request("/api/v1/me/subscriptions/p1", { method: "PUT" })).status).toBe(204);
    expect((await request("/api/v1/me/subscriptions/p1", { method: "PUT" })).status).toBe(204);
    const subscribed = await request("/api/v1/me/subscriptions");
    expect(subscribed.status).toBe(200);
    await expect(subscribed.json()).resolves.toMatchObject({ items: [{ id: "p1" }] });
    const invalid = await request("/api/v1/me/ratings/p1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: 6 }),
    });
    expect(invalid.status).toBe(400);
    expect(
      (
        await request("/api/v1/me/ratings/p1", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rating: 5, comment: "私密" }),
        })
      ).status,
    ).toBe(204);
    const state = await request("/api/v1/me/state?ids=p1");
    await expect(state.json()).resolves.toEqual({
      items: [
        {
          projectId: "p1",
          liked: true,
          subscribed: true,
          recommendationEligible: true,
          recommendation: null,
          rating: 5,
          comment: "私密",
        },
      ],
    });
    const publicProject = await SELF.fetch(
      new URL("/api/v1/projects/p1", "https://workshop.test").toString(),
      undefined,
    );
    expect(publicProject.status).toBe(200);
    expect(await publicProject.json()).not.toHaveProperty("rating");
    expect(
      await (await SELF.fetch(new URL("/api/v1/projects/p1", "https://workshop.test").toString(), undefined)).json(),
    ).not.toHaveProperty("comment");
  });

  it("keeps current subscription rows, eligibility, counts and lists exact through concurrent transitions", async () => {
    await bindings.DB.prepare("UPDATE projects SET working_version_id='r1' WHERE id='p1'").run();
    const subscribe = (active: boolean) =>
      request("/api/v1/me/subscriptions/p1", { method: active ? "PUT" : "DELETE" });
    expect((await subscribe(false)).status).toBe(204);
    expect((await bindings.DB.prepare("SELECT * FROM project_subscriptions").all()).results).toEqual([]);
    expect(
      await bindings.DB.prepare("SELECT subscriptions_count FROM projects WHERE id='p1'").first("subscriptions_count"),
    ).toBe(0);
    expect(
      (await Promise.all(Array.from({ length: 8 }, () => subscribe(true)))).map((response) => response.status),
    ).toEqual(Array(8).fill(204));
    expect((await bindings.DB.prepare("SELECT project_id,user_id FROM project_subscriptions").all()).results).toEqual([
      { project_id: "p1", user_id: "u1" },
    ]);
    expect(
      await bindings.DB.prepare("SELECT subscriptions_count FROM projects WHERE id='p1'").first("subscriptions_count"),
    ).toBe(1);
    await bindings.DB.prepare("UPDATE project_subscriptions SET created_at='2000-01-01T00:00:00.000Z'").run();
    expect(
      (await Promise.all(Array.from({ length: 8 }, () => subscribe(false)))).map((response) => response.status),
    ).toEqual(Array(8).fill(204));
    expect((await bindings.DB.prepare("SELECT * FROM project_subscriptions").all()).results).toEqual([]);
    expect(
      await bindings.DB.prepare("SELECT subscriptions_count FROM projects WHERE id='p1'").first("subscriptions_count"),
    ).toBe(0);
    await expect((await request("/api/v1/me/subscriptions")).json()).resolves.toMatchObject({ items: [] });
    await expect((await request("/api/v1/me/state?ids=p1")).json()).resolves.toMatchObject({
      items: [{ subscribed: false, recommendationEligible: false }],
    });
    expect(await getPublishedProject(bindings.DB, "p1")).toMatchObject({ counts: { subscriptions: 0 } });
    await expect((await request("/api/v1/me/projects")).json()).resolves.toMatchObject({
      items: [{ project: { id: "p1", counts: { subscriptions: 0 } } }],
    });
    expect((await listAdminProjects(bindings.DB, 20)).items).toMatchObject([
      { id: "p1", counts: { subscriptions: 0 } },
    ]);
    expect(
      (await Promise.all(Array.from({ length: 8 }, () => subscribe(true)))).map((response) => response.status),
    ).toEqual(Array(8).fill(204));
    expect((await bindings.DB.prepare("SELECT project_id,user_id FROM project_subscriptions").all()).results).toEqual([
      { project_id: "p1", user_id: "u1" },
    ]);
    expect(
      await bindings.DB.prepare("SELECT subscriptions_count FROM projects WHERE id='p1'").first("subscriptions_count"),
    ).toBe(1);
    expect(await bindings.DB.prepare("SELECT created_at FROM project_subscriptions").first("created_at")).not.toBe(
      "2000-01-01T00:00:00.000Z",
    );
    await bindings.DB.prepare("UPDATE project_subscriptions SET created_at='2001-01-01T00:00:00.000Z'").run();
    expect((await subscribe(true)).status).toBe(204);
    expect(await bindings.DB.prepare("SELECT created_at FROM project_subscriptions").first("created_at")).toBe(
      "2001-01-01T00:00:00.000Z",
    );
    await expect((await request("/api/v1/me/subscriptions")).json()).resolves.toMatchObject({ items: [{ id: "p1" }] });
    await Promise.all(Array.from({ length: 12 }, (_, index) => subscribe(index % 2 === 0)));
    const rows = (await bindings.DB.prepare("SELECT * FROM project_subscriptions").all()).results;
    expect(
      await bindings.DB.prepare("SELECT subscriptions_count FROM projects WHERE id='p1'").first("subscriptions_count"),
    ).toBe(rows.length);
    expect(rows.length).toBeLessThanOrEqual(1);
    await expect((await request("/api/v1/me/state?ids=p1")).json()).resolves.toMatchObject({
      items: [{ subscribed: rows.length === 1, recommendationEligible: rows.length === 1 }],
    });
  });

  it("preserves a stored comment when changing only stars and clears it only explicitly", async () => {
    const save = (body: { rating: number; comment?: string }) =>
      request("/api/v1/me/ratings/p1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await save({ rating: 5, comment: "保留这条留言" })).status).toBe(204);
    const initial = await request("/api/v1/me/state?ids=p1");
    await expect(initial.json()).resolves.toMatchObject({
      items: [{ rating: 5, comment: "保留这条留言" }],
    });
    expect((await save({ rating: 4 })).status).toBe(204);
    const updated = await request("/api/v1/me/state?ids=p1");
    await expect(updated.json()).resolves.toMatchObject({
      items: [{ rating: 4, comment: "保留这条留言" }],
    });
    expect((await save({ rating: 3, comment: "" })).status).toBe(204);
    const cleared = await request("/api/v1/me/state?ids=p1");
    await expect(cleared.json()).resolves.toMatchObject({ items: [{ rating: 3, comment: "" }] });
    expect((await request("/api/v1/me/ratings/p1", { method: "DELETE" })).status).toBe(204);
    const removed = await request("/api/v1/me/state?ids=p1");
    await expect(removed.json()).resolves.toMatchObject({ items: [{ rating: null, comment: null }] });
  });

  it("does not expose another user's rating comment through personal state", async () => {
    await bindings.DB.prepare("INSERT INTO users (id, username, role) VALUES ('u2', 'other', 'member')").run();
    await bindings.DB.prepare(
      "INSERT INTO project_ratings (project_id, user_id, rating, comment_text) VALUES ('p1', 'u2', 2, '另一位用户的留言')",
    ).run();
    const personal = await request("/api/v1/me/state?ids=p1");
    await expect(personal.json()).resolves.toMatchObject({ items: [{ rating: null, comment: null }] });
    const anonymous = await SELF.fetch(
      new URL("/api/v1/me/state?ids=p1", "https://workshop.test").toString(),
      undefined,
    );
    expect(anonymous.status).toBe(401);
  });
});
