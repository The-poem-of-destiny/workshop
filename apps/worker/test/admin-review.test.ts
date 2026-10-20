import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schema from "../migrations/0001_initial.sql?raw";
import { adminRoutes } from "../src/http/routes/admin";
import type { Env } from "../src/env";
import { splitSql } from "./support/sql";

const bindings = env as unknown as Env;
const now = "2026-10-21T00:00:00.000Z";

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function seedSession(token: string, userId: string) {
  await bindings.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at, last_seen_at)
    VALUES (?, ?, 1, '2099-01-01T00:00:00.000Z', ?, ?)
  `).bind(await tokenHash(token), userId, now, now).run();
}

async function seed() {
  const statements = splitSql(`
    INSERT INTO users (id, username, global_name, role, created_at, updated_at) VALUES
      ('owner', 'owner', 'Owner', 'owner', '${now}', '${now}'),
      ('reviewer', 'reviewer', 'Reviewer', 'reviewer', '${now}', '${now}'),
      ('member', 'member', 'Member', 'member', '${now}', '${now}');
    INSERT INTO projects
      (id, author_id, title, description, author_note, project_type, extension_type,
       search_tags, visibility, working_revision_id, updated_at)
    VALUES ('p1', 'member', 'Draft title', 'Draft description', 'Draft note', '角色', '内容',
      '["draft"]', 'private', 'r1', '${now}');
    INSERT INTO project_revisions
      (id, project_id, revision_no, title, description, author_note, project_type, extension_type,
       tags, metadata, manifest_hash, created_by, created_at)
    VALUES ('r1', 'p1', 1, 'Submitted title', 'Submitted description', 'Submitted note', '事件', '规则',
      '["submitted"]', '{"schema":"4.3"}', 'manifest-1', 'member', '${now}');
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('a1', 'p1', 'r1', 'worldbook', 'projects/p1/r1/worldbook.json', 'hash', 12,
      'application/json', '${now}');
    INSERT INTO submissions
      (id, project_id, revision_id, status, gate, checker_revision, submitted_by, submitted_at)
    VALUES ('s1', 'p1', 'r1', 'pending', 'warn', 'checker-1', 'member', '${now}');
  `);
  for (const statement of statements) await bindings.DB.prepare(statement).run();
  await seedSession("owner-token", "owner");
  await seedSession("reviewer-token", "reviewer");
  await seedSession("member-token", "member");
}

function request(path: string, token = "reviewer-token", init?: RequestInit) {
  return adminRoutes.request(path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  }, bindings);
}

beforeAll(async () => {
  const sql = schema.replace(/^\s*--.*$/gm, "").replace(/^\s*PRAGMA\b.*$/gm, "");
  for (const statement of splitSql(sql)) await bindings.DB.prepare(statement).run();
});

beforeEach(async () => {
  await bindings.DB.exec("DELETE FROM reviews; DELETE FROM submissions; DELETE FROM assets; DELETE FROM projects; DELETE FROM sessions; DELETE FROM users;");
  await seed();
});

describe("admin review and publishing", () => {
  it("requires reviewer access and lists the queue", async () => {
    await expect((await request("/submissions", "member-token")).status).toBe(403);
    const response = await request("/submissions?status=pending");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: "s1", projectTitle: "Draft title", gate: "warn", checkerRevision: "checker-1" }],
    });
  });

  it("returns detail metadata without file contents", async () => {
    const response = await request("/submissions/s1");
    expect(response.status).toBe(200);
    const body = await response.json() as { revision: Record<string, unknown>; assets: Array<Record<string, unknown>> };
    expect(body.revision).toMatchObject({ id: "r1", manifestHash: "manifest-1" });
    expect(body.assets).toEqual([expect.objectContaining({ kind: "worldbook", r2Key: "projects/p1/r1/worldbook.json" })]);
    expect(body.assets[0]).not.toHaveProperty("content");
  });

  it("approves atomically and switches the published pointer", async () => {
    const response = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "approve", checkerVersion: "review-2", report: { warnings: 1 } }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(201);
    const project = await bindings.DB.prepare("SELECT published_revision_id, title, search_tags, row_version FROM projects WHERE id = 'p1'").first<Record<string, unknown>>();
    expect(project).toMatchObject({ published_revision_id: "r1", title: "Submitted title", search_tags: '["submitted"]', row_version: 2 });
    const review = await bindings.DB.prepare("SELECT manifest_hash, checker_version FROM reviews WHERE submission_id = 's1'").first<Record<string, unknown>>();
    expect(review).toMatchObject({ manifest_hash: "manifest-1", checker_version: "review-2" });
  });

  it("rejects without changing the published pointer and prevents double review", async () => {
    const first = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST", body: JSON.stringify({ decision: "reject", reason: "unsafe" }),
      headers: { "content-type": "application/json" },
    });
    expect(first.status).toBe(201);
    const second = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST", body: JSON.stringify({ decision: "approve" }),
      headers: { "content-type": "application/json" },
    });
    expect(second.status).toBe(409);
    const project = await bindings.DB.prepare("SELECT published_revision_id FROM projects WHERE id = 'p1'").first<{ published_revision_id: string | null }>();
    expect(project?.published_revision_id).toBeNull();
  });

  it("invalidates changed member sessions and guards the last owner", async () => {
    const changed = await request("/members/reviewer/role", "owner-token", {
      method: "PUT", body: JSON.stringify({ role: "member" }), headers: { "content-type": "application/json" },
    });
    expect(changed.status).toBe(200);
    expect((await request("/submissions", "reviewer-token")).status).toBe(401);
    const lastOwner = await request("/members/owner/role", "owner-token", {
      method: "PUT", body: JSON.stringify({ role: "member" }), headers: { "content-type": "application/json" },
    });
    expect(lastOwner.status).toBe(409);
  });
});
