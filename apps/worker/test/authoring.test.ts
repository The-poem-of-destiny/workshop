import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schema from "../migrations/0001_initial.sql?raw";
import { authoringRoutes } from "../src/http/routes/authoring";
import type { Env } from "../src/env";
import { splitSql } from "./support/sql";

const bindings = env as unknown as Env;
const now = "2026-10-21T00:00:00.000Z";

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function seedUser(id: string, role: "member" | "owner" = "member", token = `${id}-token`) {
  await bindings.DB.prepare("INSERT INTO users (id, username, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, id, role, now, now).run();
  await bindings.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(await tokenHash(token), id, "2099-01-01T00:00:00.000Z").run();
}

async function request(path: string, init: RequestInit = {}, token = "author-token") {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return authoringRoutes.request(path, { ...init, headers }, bindings);
}

beforeAll(async () => {
  const sql = schema.replace(/^\s*--.*$/gm, "").replace(/^\s*PRAGMA\b.*$/gm, "");
  for (const statement of splitSql(sql)) await bindings.DB.prepare(statement).run();
});

beforeEach(async () => {
  await bindings.DB.exec(`
    DELETE FROM reviews;
    DELETE FROM project_likes;
    DELETE FROM project_subscriptions;
    DELETE FROM project_ratings;
    DELETE FROM submissions;
    DELETE FROM assets;
    DELETE FROM project_revisions;
    DELETE FROM projects;
    DELETE FROM sessions;
    DELETE FROM users;
  `);
  await seedUser("author");
  await seedUser("other");
  await seedUser("owner", "owner");
});

describe("authoring write paths", () => {
  it("creates projects and enforces the row-version CAS", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "New project", description: "draft", tags: ["tag"] }),
      headers: { "content-type": "application/json" },
    });
    expect(created.status).toBe(201);
    const body = await created.json() as { project: { id: string; visibility: string }; rowVersion: number; workingRevisionId: string };
    expect(body.project.visibility).toBe("private");
    expect(body.rowVersion).toBe(1);
    expect(body.workingRevisionId).toBeTruthy();

    const mismatch = await request(`/${body.project.id}`, {
      method: "PATCH", headers: { "content-type": "application/json", "if-match": "99" },
      body: JSON.stringify({ title: "stale" }),
    });
    expect(mismatch.status).toBe(412);
  });

  it("hides projects from non-authors and permits owners", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Private" }) });
    const { project } = await created.json() as { project: { id: string } };
    const forbidden = await request(`/${project.id}`, { method: "PATCH", headers: { "if-match": "1" }, body: JSON.stringify({ title: "no" }) }, "other-token");
    expect(forbidden.status).toBe(404);
    const allowed = await request(`/${project.id}`, { method: "PATCH", headers: { "if-match": "1" }, body: JSON.stringify({ title: "owner edit" }) }, "owner-token");
    expect(allowed.status).toBe(200);
  });

  it("keeps revision numbers immutable and uploads hashed assets", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Versions" }) });
    const first = await created.json() as { project: { id: string }; workingRevisionId: string };
    const revision = await request(`/${first.project.id}/revisions`, { method: "POST", body: JSON.stringify({ title: "Second" }) });
    expect(revision.status).toBe(201);
    const second = await revision.json() as { revisionId: string };
    const upload = await request(`/${first.project.id}/revisions/${second.revisionId}/files/worldbook`, {
      method: "PUT", body: '{"entries":[]}', headers: { "content-type": "application/json" },
    });
    expect(upload.status).toBe(200);
    await expect(upload.json()).resolves.toMatchObject({ kind: "worldbook", bytes: 14, mime: "application/json" });
    const object = await bindings.R2.get(`projects/${first.project.id}/revisions/${second.revisionId}/worldbook.json`);
    await expect(object?.text()).resolves.toBe('{"entries":[]}');
    const rows = await bindings.DB.prepare("SELECT revision_no FROM project_revisions WHERE project_id = ? ORDER BY revision_no")
      .bind(first.project.id).all<{ revision_no: number }>();
    expect(rows.results.map(row => row.revision_no)).toEqual([1, 2]);
  });

  it("supersedes pending submissions and rejects unsupported/oversized uploads", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Submit" }) });
    const first = await created.json() as { project: { id: string }; workingRevisionId: string };
    const submit = async () => request(`/${first.project.id}/revisions/${first.workingRevisionId}/submit`, {
      method: "POST", body: JSON.stringify({ gate: "warn", checkerRevision: "c1" }),
    });
    expect((await submit()).status).toBe(201);
    expect((await submit()).status).toBe(201);
    const statuses = await bindings.DB.prepare("SELECT status FROM submissions WHERE project_id = ? ORDER BY submitted_at")
      .bind(first.project.id).all<{ status: string }>();
    expect(statuses.results.map(row => row.status)).toEqual(["superseded", "pending"]);
    const forbidden = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/nope`, { method: "PUT", body: "x" });
    expect(forbidden.status).toBe(400);
    const oversized = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/cover`, { method: "PUT", body: new Uint8Array(10 * 1024 * 1024 + 1) });
    expect(oversized.status).toBe(413);
  });
});
