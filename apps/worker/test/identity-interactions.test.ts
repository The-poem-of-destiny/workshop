import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schema from "../migrations/0001_initial.sql?raw";
import { app } from "../src/app";
import type { Env } from "../src/env";
import { splitSql } from "./support/sql";

const bindings = env as unknown as Env;
const now = "2026-10-21T00:00:00.000Z";
const token = "identity-interactions-token";

async function tokenHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

beforeAll(async () => {
  const sql = schema.replace(/^\s*--.*$/gm, "").replace(/^\s*PRAGMA\b.*$/gm, "");
  for (const statement of splitSql(sql)) await bindings.DB.prepare(statement).run();
});

beforeEach(async () => {
  await bindings.DB.exec(`
    DELETE FROM oauth_flows;
    DELETE FROM project_ratings;
    DELETE FROM project_subscriptions;
    DELETE FROM project_likes;
    DELETE FROM sessions;
    DELETE FROM projects;
    DELETE FROM users;
  `);
  await bindings.DB.prepare(
    "INSERT INTO users (id, username, global_name, avatar, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'member', ?, ?)",
  ).bind("u1", "tester", "测试用户", "avatar-hash", now, now).run();
  await bindings.DB.prepare(`
    INSERT INTO projects (id, author_id, title, visibility, published_revision_id, updated_at)
    VALUES ('p1', 'u1', '测试项目', 'public', 'r1', ?)
  `).bind(now).run();
  await bindings.DB.prepare(`
    INSERT INTO project_revisions (id, project_id, revision_no, title, created_by)
    VALUES ('r1', 'p1', 1, '测试项目', 'u1')
  `).run();
  await bindings.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, 'u1', '2099-01-01T00:00:00.000Z')",
  ).bind(await tokenHash(token)).run();
});

const auth = { Authorization: `Bearer ${token}` };

async function request(path: string, init?: RequestInit): Promise<Response> {
  return app.request(path, { ...init, headers: { ...auth, ...init?.headers } }, {
    ...bindings,
    ALLOWED_ORIGINS: "https://workshop.example",
  });
}

describe("identity and interactions", () => {
  it("requires a valid session and returns the me shape", async () => {
    const anonymous = await app.request("/api/v1/me", undefined, bindings);
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
    const rejected = await app.request("/api/v1/auth/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "browser", origin: "https://evil.example" }),
    }, { ...bindings, ALLOWED_ORIGINS: "https://workshop.example" });
    expect(rejected.status).toBe(403);
    const created = await app.request("/api/v1/auth/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "device", origin: "https://workshop.example" }),
    }, { ...bindings, ALLOWED_ORIGINS: "https://workshop.example" });
    expect(created.status).toBe(201);
    const flow = await created.json() as { id: string; state: string; url: string; expiresAt: string };
    expect(flow.state).toEqual(expect.any(String));
    expect(flow.url).toContain("/auth/pending");
    const status = await app.request(`/api/v1/auth/flows/${flow.id}`, undefined, bindings);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({ status: "pending", expiresAt: flow.expiresAt });
  });

  it("applies idempotent likes and subscriptions and keeps ratings private", async () => {
    expect((await request("/api/v1/me/likes/p1", { method: "PUT" })).status).toBe(204);
    expect((await request("/api/v1/me/likes/p1", { method: "PUT" })).status).toBe(204);
    expect((await request("/api/v1/me/subscriptions/p1", { method: "PUT" })).status).toBe(204);
    expect((await request("/api/v1/me/subscriptions/p1", { method: "PUT" })).status).toBe(204);
    const invalid = await request("/api/v1/me/ratings/p1", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: 6 }),
    });
    expect(invalid.status).toBe(400);
    expect((await request("/api/v1/me/ratings/p1", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: 5, comment: "私密" }),
    })).status).toBe(204);
    const state = await request("/api/v1/me/state?ids=p1");
    await expect(state.json()).resolves.toEqual({ items: [{ projectId: "p1", liked: true, subscribed: true, rating: 5 }] });
    const publicProject = await app.request("/api/v1/projects/p1", undefined, bindings);
    expect(publicProject.status).toBe(200);
    expect(await publicProject.json()).not.toHaveProperty("rating");
  });
});
