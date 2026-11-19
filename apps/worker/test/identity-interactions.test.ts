import { env, SELF } from "cloudflare:test";
import type { ExperienceNotesResponse } from "@workshop/contracts";
import { CURRENT_POLICY_VERSION } from "@workshop/domain";
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
    DELETE FROM project_experience_notes;
    DELETE FROM project_unversioned_notes;
    DELETE FROM project_subscriptions;
    DELETE FROM project_likes;
    DELETE FROM sessions;
    UPDATE projects SET working_version_id = NULL, published_version_id = NULL, published_cover_asset_id = NULL;
    DELETE FROM project_versions;
    DELETE FROM projects;
    DELETE FROM users;
  `);
  await bindings.DB.prepare(
    "INSERT INTO users (id, username, global_name, avatar, role, policy_accepted_version, policy_accepted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'member', ?, ?, ?, ?)",
  )
    .bind("u1", "tester", "测试用户", "avatar-hash", CURRENT_POLICY_VERSION, now, now, now)
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

const notePath = (versionId = "r1", projectId = "p1") =>
  `/api/v1/me/experience-notes/${projectId}/versions/${versionId}`;
const saveNote = (body: { rating: number; comment?: string }, versionId = "r1", projectId = "p1") =>
  request(notePath(versionId, projectId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
async function notes(): Promise<ExperienceNotesResponse> {
  const response = await request("/api/v1/me/experience-notes/p1");
  expect(response.status).toBe(200);
  return response.json();
}

async function publishSecondVersion(): Promise<void> {
  await bindings.DB.batch([
    bindings.DB.prepare(`INSERT INTO project_versions
      (id, project_id, version_no, version_label, title, project_type, created_by)
      VALUES ('r2', 'p1', 2, '新版', '测试项目', '角色', 'u1')`),
    bindings.DB.prepare("UPDATE projects SET published_version_id = 'r2' WHERE id = 'p1'"),
  ]);
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
      policy: {
        currentVersion: CURRENT_POLICY_VERSION,
        acceptedVersion: CURRENT_POLICY_VERSION,
        acceptedAt: now,
        accepted: true,
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
    const hmacDigest = await hashSessionToken(tokenValue, "staging-secret");
    expect(hmacDigest).toMatch(/^[a-f0-9]{64}$/);
    await bindings.DB.prepare("DELETE FROM sessions").run();
    await bindings.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, 'u1', '2099-01-01T00:00:00.000Z')",
    )
      .bind(hmacDigest)
      .run();
    expect(
      (await identityMe({ ...bindings, SESSION_HASH_SECRET: "staging-secret" }, tokenValue, { kind: "me" })).ok,
    ).toBe(true);
    expect(
      (await identityMe({ ...bindings, SESSION_HASH_SECRET: "wrong-secret" }, tokenValue, { kind: "me" })).ok,
    ).toBe(false);
    expect((await identityMe({ ...bindings, SESSION_HASH_SECRET: undefined }, tokenValue, { kind: "me" })).ok).toBe(
      false,
    );
  });

  it("applies idempotent likes and subscriptions without carrying personal scores in interaction state", async () => {
    expect((await request("/api/v1/me/likes/p1", { method: "PUT" })).status).toBe(204);
    expect((await request("/api/v1/me/likes/p1", { method: "PUT" })).status).toBe(204);
    expect((await request("/api/v1/me/subscriptions/p1", { method: "PUT" })).status).toBe(204);
    expect((await request("/api/v1/me/subscriptions/p1", { method: "PUT" })).status).toBe(204);
    const subscribed = await request("/api/v1/me/subscriptions");
    expect(subscribed.status).toBe(200);
    await expect(subscribed.json()).resolves.toMatchObject({ items: [{ id: "p1" }] });
    expect((await saveNote({ rating: 5, comment: "私密" })).status).toBe(204);
    await expect((await request("/api/v1/me/state?ids=p1")).json()).resolves.toEqual({
      items: [{ projectId: "p1", liked: true, subscribed: true, recommendationEligible: true, recommendation: null }],
    });
    const publicProject = await SELF.fetch("https://workshop.test/api/v1/projects/p1");
    expect(publicProject.status).toBe(200);
    const publicBody = await publicProject.text();
    expect(publicBody).not.toContain("私密");
    for (const field of ["rating", "comment", "unversionedNote", "note"]) {
      expect(JSON.parse(publicBody)).not.toHaveProperty(field);
    }
    const listing = await SELF.fetch("https://workshop.test/api/v1/projects");
    expect(await listing.text()).not.toContain("私密");
  });

  it("requires an explicit accessible version of the same project and retains existing input limits", async () => {
    for (const rating of [0, 6, 1.5]) expect((await saveNote({ rating })).status).toBe(400);
    expect((await saveNote({ rating: 5, comment: "字".repeat(2001) })).status).toBe(400);
    expect((await request(notePath(), { method: "PUT", body: "{" })).status).toBe(400);
    expect((await request("/api/v1/me/experience-notes/p1/versions", { method: "PUT" })).status).toBe(404);
    expect((await saveNote({ rating: 5 }, "missing")).status).toBe(404);
    await bindings.DB.batch([
      bindings.DB.prepare("INSERT INTO projects (id, author_id, visibility) VALUES ('p2', 'u1', 'public')"),
      bindings.DB.prepare(`INSERT INTO project_versions (id, project_id, version_no, title, project_type, created_by)
        VALUES ('foreign', 'p2', 1, '另一个项目', '角色', 'u1'), ('draft', 'p1', 3, '未发布', '角色', 'u1')`),
      bindings.DB.prepare("UPDATE projects SET published_version_id = 'foreign' WHERE id = 'p2'"),
    ]);
    expect((await saveNote({ rating: 5 }, "foreign")).status).toBe(404);
    expect((await saveNote({ rating: 5 }, "r1", "p2")).status).toBe(404);
    expect((await saveNote({ rating: 5 }, "draft")).status).toBe(404);
    expect((await notes()).versions.map((version) => version.projectVersionId)).toEqual(["r1"]);
    expect((await saveNote({ rating: 1, comment: "字".repeat(2000) })).status).toBe(204);
    await expect(
      bindings.DB.prepare(`INSERT INTO project_experience_notes
      (project_id,user_id,project_version_id,rating) VALUES ('p2','u1','r1',5)`).run(),
    ).rejects.toThrow();
  });

  it("preserves omitted comments, clears explicit empty comments, and deletes only the specified version", async () => {
    expect((await saveNote({ rating: 5, comment: "保留这条体验" })).status).toBe(204);
    expect((await saveNote({ rating: 4 })).status).toBe(204);
    expect((await notes()).versions[0]?.note).toMatchObject({ rating: 4, comment: "保留这条体验" });
    expect((await saveNote({ rating: 3, comment: "" })).status).toBe(204);
    expect((await notes()).versions[0]?.note).toMatchObject({ rating: 3, comment: "" });
    expect((await request(notePath(), { method: "DELETE" })).status).toBe(204);
    expect((await notes()).versions[0]?.note).toBeNull();
  });

  it("isolates old and current versions across republishing, concurrent saves, edits and deletion", async () => {
    expect((await saveNote({ rating: 5, comment: "第一版" })).status).toBe(204);
    await publishSecondVersion();
    expect((await notes()).versions).toMatchObject([
      { projectVersionId: "r2", isCurrent: true, note: null },
      { projectVersionId: "r1", isCurrent: false, note: { rating: 5, comment: "第一版" } },
    ]);
    const results = await Promise.all([
      saveNote({ rating: 2, comment: "第二版" }, "r2"),
      saveNote({ rating: 4, comment: "第一版修订" }),
    ]);
    expect(results.map((response) => response.status)).toEqual([204, 204]);
    expect((await notes()).versions.map((version) => version.note)).toMatchObject([
      { rating: 2, comment: "第二版" },
      { rating: 4, comment: "第一版修订" },
    ]);
    const sameVersion = await Promise.all([saveNote({ rating: 1 }, "r2"), saveNote({ rating: 3 }, "r2")]);
    expect(sameVersion.map((response) => response.status)).toEqual([204, 204]);
    expect(
      await bindings.DB.prepare(
        "SELECT count(*) AS count FROM project_experience_notes WHERE project_version_id='r2'",
      ).first("count"),
    ).toBe(1);
    expect((await request(notePath(), { method: "DELETE" })).status).toBe(204);
    expect((await notes()).versions).toHaveLength(1);
    expect((await notes()).versions[0]?.note?.comment).toBe("第二版");
    expect((await saveNote({ rating: 5 })).status).toBe(404);
    expect((await saveNote({ rating: 5 }, "r2")).status).toBe(204);
  });

  it("denies anonymous, hidden, deleted, unpublished and other-user historical access", async () => {
    await bindings.DB.batch([
      bindings.DB.prepare("INSERT INTO users (id, username, role) VALUES ('u2', 'other', 'member')"),
      bindings.DB.prepare(`INSERT INTO project_experience_notes (project_id,user_id,project_version_id,rating,comment_text)
        VALUES ('p1','u2','r1',2,'另一位用户的体验')`),
      bindings.DB.prepare(`INSERT INTO project_unversioned_notes (project_id,user_id,rating,comment_text)
        VALUES ('p1','u2',5,'另一位用户的旧备忘')`),
    ]);
    expect((await notes()).versions[0]?.note).toBeNull();
    expect((await notes()).unversionedNote).toBeNull();
    expect((await request(notePath(), { method: "DELETE" })).status).toBe(404);
    expect((await request("/api/v1/me/experience-notes/p1/unversioned", { method: "DELETE" })).status).toBe(404);
    await publishSecondVersion();
    expect((await notes()).versions.map((version) => version.projectVersionId)).toEqual(["r2"]);
    expect((await saveNote({ rating: 5 })).status).toBe(404);
    for (const [path, method] of [
      ["/api/v1/me/experience-notes/p1", "GET"],
      [notePath("r2"), "PUT"],
      [notePath("r2"), "DELETE"],
      ["/api/v1/me/experience-notes/p1/unversioned", "DELETE"],
    ]) {
      expect((await SELF.fetch(`https://workshop.test${path}`, { method })).status).toBe(401);
    }
    expect((await saveNote({ rating: 4 }, "r2")).status).toBe(204);
    for (const mutation of [
      "visibility='private'",
      "visibility='public',deleted_at='2026-11-17'",
      "deleted_at=NULL,published_version_id=NULL",
    ]) {
      await bindings.DB.prepare(`UPDATE projects SET ${mutation} WHERE id='p1'`).run();
      expect((await request("/api/v1/me/experience-notes/p1")).status).toBe(404);
      expect((await saveNote({ rating: 5 }, "r2")).status).toBe(404);
      expect((await request(notePath("r2"), { method: "DELETE" })).status).toBe(404);
    }
    expect(
      await bindings.DB.prepare("SELECT rating FROM project_experience_notes WHERE user_id='u1'").first("rating"),
    ).toBe(4);
    expect(
      await bindings.DB.prepare("SELECT rating FROM project_experience_notes WHERE user_id='u2'").first("rating"),
    ).toBe(2);
  });

  it("retains unversioned history separately, never carries it to a version or recommendation, and lets its owner delete it", async () => {
    await bindings.DB.prepare(`INSERT INTO project_unversioned_notes
      (project_id,user_id,rating,comment_text,created_at,updated_at) VALUES ('p1','u1',5,'原样旧记录',?,?)`)
      .bind(now, now)
      .run();
    const retained = await notes();
    expect(retained.unversionedNote).toEqual({ rating: 5, comment: "原样旧记录", createdAt: now, updatedAt: now });
    expect(retained.versions[0]?.note).toBeNull();
    expect((await saveNote({ rating: 3, comment: "新版记录" })).status).toBe(204);
    expect((await notes()).unversionedNote).toEqual(retained.unversionedNote);
    expect(await bindings.DB.prepare("SELECT count(*) AS count FROM recommendations").first("count")).toBe(0);
    expect(
      (
        await request("/api/v1/me/experience-notes/p1/unversioned", {
          method: "PUT",
          body: JSON.stringify({ rating: 1 }),
        })
      ).status,
    ).toBe(404);
    expect((await request("/api/v1/me/experience-notes/p1/unversioned", { method: "DELETE" })).status).toBe(204);
    expect((await notes()).unversionedNote).toBeNull();
    expect((await notes()).versions[0]?.note).toMatchObject({ rating: 3, comment: "新版记录" });
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
});
