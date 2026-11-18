import { env, SELF } from "cloudflare:test";
import { CURRENT_POLICY_VERSION, DEFAULT_COMMUNITY_INVITE_URL } from "@workshop/domain";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataEnv } from "../src/data/env";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const ORIGIN = "https://workshop.test";
const GUILD = "123456789012345678";
const now = "2026-11-18T00:00:00.000Z";
const originalSettings = {
  ALLOWED_ORIGINS: bindings.ALLOWED_ORIGINS,
  PUBLIC_ORIGIN: bindings.PUBLIC_ORIGIN,
  DISCORD_CLIENT_ID: bindings.DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET: bindings.DISCORD_CLIENT_SECRET,
  DISCORD_ALLOWED_GUILD_IDS: bindings.DISCORD_ALLOWED_GUILD_IDS,
  DISCORD_GUILD_ROLE_IDS: bindings.DISCORD_GUILD_ROLE_IDS,
  CACHE_TTL_PUBLIC_SECONDS: bindings.CACHE_TTL_PUBLIC_SECONDS,
};

const CORRECT_ANSWERS = {
  "issue-handling": "contact-author",
  "content-liability": "author-responsible",
  "install-behavior": "append-and-backup",
};

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedUser(options: {
  id: string;
  role?: "member" | "reviewer" | "owner";
  acceptedVersion?: string | null;
  token: string;
}) {
  const acceptedVersion = options.acceptedVersion ?? null;
  const acceptedAt = acceptedVersion ? now : null;
  await bindings.DB.prepare(
    `INSERT INTO users (id, username, global_name, role, policy_accepted_version, policy_accepted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(options.id, options.id, `Name ${options.id}`, options.role ?? "member", acceptedVersion, acceptedAt, now, now)
    .run();
  await bindings.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at, last_seen_at)
     VALUES (?, ?, 1, '2099-01-01T00:00:00.000Z', ?, ?)`,
  )
    .bind(await tokenHash(options.token), options.id, now, now)
    .run();
}

async function seedPublishedProject(options: {
  id: string;
  authorId: string;
  title: string;
  visibility?: "public" | "private";
  projectType?: string;
  tags?: string[];
}) {
  const versionId = `${options.id}-v1`;
  const tagsJson = JSON.stringify(options.tags ?? ["奇幻"]);
  await bindings.DB.prepare(
    `INSERT INTO projects (id, author_id, visibility, published_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(options.id, options.authorId, options.visibility ?? "public", now, now)
    .run();
  await bindings.DB.prepare(
    `INSERT INTO project_versions (id, project_id, version_no, title, description, project_type, included_types, tags, entry_index, manifest_hash, created_by, created_at)
     VALUES (?, ?, 1, ?, '公开简介', ?, '[]', ?, '{"schemaVersion":1,"entries":[]}', ?, ?, ?)`,
  )
    .bind(
      versionId,
      options.id,
      options.title,
      options.projectType ?? "角色",
      tagsJson,
      "a".repeat(64),
      options.authorId,
      now,
    )
    .run();
  await bindings.DB.prepare(`UPDATE projects SET working_version_id = ?, published_version_id = ? WHERE id = ?`)
    .bind(versionId, versionId, options.id)
    .run();
  await bindings.DB.prepare(
    `INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
     VALUES (?, ?, ?, 'worldbook', ?, ?, 16, 'application/json', ?)`,
  )
    .bind(
      `${options.id}-wb`,
      options.id,
      versionId,
      `projects/${options.id}/${versionId}/worldbook-${"b".repeat(64)}.json`,
      "b".repeat(64),
      now,
    )
    .run();
  await bindings.R2.put(`projects/${options.id}/${versionId}/worldbook-${"b".repeat(64)}.json`, '{"entries":[]}');
}

function api(path: string, token?: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return SELF.fetch(new URL(path, ORIGIN).toString(), { ...init, headers });
}

beforeAll(async () => {
  await applySchema(bindings.DB);
  Object.assign(bindings, {
    ALLOWED_ORIGINS: ORIGIN,
    PUBLIC_ORIGIN: ORIGIN,
    DISCORD_CLIENT_ID: "client-id",
    DISCORD_CLIENT_SECRET: "client-secret",
    DISCORD_ALLOWED_GUILD_IDS: GUILD,
    DISCORD_GUILD_ROLE_IDS: "",
    CACHE_TTL_PUBLIC_SECONDS: "0",
  });
});

afterAll(() => {
  Object.assign(bindings, originalSettings);
});

beforeEach(async () => {
  await bindings.DB.exec(
    "DELETE FROM audit_events; DELETE FROM collection_projects; DELETE FROM collections; DELETE FROM project_likes; DELETE FROM project_subscriptions; DELETE FROM download_daily_stats; DELETE FROM oauth_flows; DELETE FROM site_settings; UPDATE projects SET working_version_id = NULL, published_version_id = NULL, published_cover_asset_id = NULL; DELETE FROM project_search_tags; DELETE FROM assets; DELETE FROM project_versions; DELETE FROM projects; DELETE FROM sessions; DELETE FROM users;",
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("policy acceptance & quiz gate", () => {
  it("blocks authenticated capabilities with 403 until the 3-question quiz is passed", async () => {
    await seedUser({ id: "owner-pending", role: "owner", acceptedVersion: null, token: "pending-token" });
    await seedUser({ id: "author-ok", role: "member", acceptedVersion: CURRENT_POLICY_VERSION, token: "author-token" });
    await seedPublishedProject({ id: "pub-1", authorId: "author-ok", title: "测试世界模组" });

    // Guest browsing still works even with no token or unaccepted session
    expect((await api("/api/v1/projects/pub-1")).status).toBe(200);

    // /me succeeds and reports accepted: false
    const meBefore = await api("/api/v1/me", "pending-token");
    expect(meBefore.status).toBe(200);
    await expect(meBefore.json()).resolves.toMatchObject({
      user: { id: "owner-pending", role: "owner" },
      policy: {
        currentVersion: CURRENT_POLICY_VERSION,
        acceptedVersion: null,
        acceptedAt: null,
        accepted: false,
      },
    });

    // All non-exempt authenticated routes return 403 forbidden
    expect((await api("/api/v1/me/projects", "pending-token")).status).toBe(403);
    expect((await api("/api/v1/me/likes/pub-1", "pending-token", { method: "PUT" })).status).toBe(403);
    expect((await api("/api/v1/projects/pub-1/preview/worldbook", "pending-token")).status).toBe(403);
    expect(
      (
        await api("/api/v1/projects/pub-1/downloads", "pending-token", {
          method: "POST",
          headers: { "Idempotency-Key": "11111111-1111-4111-8111-111111111111" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api("/api/v1/projects", "pending-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "新模组", projectType: "角色" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api("/api/v1/collections", "pending-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "新合集" }),
        })
      ).status,
    ).toBe(403);
    expect((await api("/api/v1/admin/projects", "pending-token")).status).toBe(403);

    // Wrong quiz answer is rejected with 400 and incorrectQuestionIds
    const wrongQuiz = await api("/api/v1/me/policy-acceptance", "pending-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: CURRENT_POLICY_VERSION,
        agreed: true,
        answers: {
          ...CORRECT_ANSWERS,
          "issue-handling": "contact-official",
        },
      }),
    });
    expect(wrongQuiz.status).toBe(400);
    await expect(wrongQuiz.json()).resolves.toMatchObject({
      error: {
        code: "bad_request",
        details: { incorrectQuestionIds: ["issue-handling"] },
      },
    });

    // Passing all 3 questions unlocks the session and writes audit log
    const passedQuiz = await api("/api/v1/me/policy-acceptance", "pending-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: CURRENT_POLICY_VERSION,
        agreed: true,
        answers: CORRECT_ANSWERS,
      }),
    });
    expect(passedQuiz.status).toBe(200);
    await expect(passedQuiz.json()).resolves.toMatchObject({
      policy: {
        currentVersion: CURRENT_POLICY_VERSION,
        acceptedVersion: CURRENT_POLICY_VERSION,
        accepted: true,
      },
    });

    expect((await api("/api/v1/me/likes/pub-1", "pending-token", { method: "PUT" })).status).toBe(204);
    expect((await api("/api/v1/projects/pub-1/preview/worldbook", "pending-token")).status).toBe(200);
    expect((await api("/api/v1/admin/projects", "pending-token")).status).toBe(200);

    const audit = await bindings.DB.prepare(
      "SELECT action, actor_id, detail FROM audit_events WHERE action = 'member.policy_accept'",
    ).first<{ action: string; actor_id: string; detail: string }>();
    expect(audit).toMatchObject({
      action: "member.policy_accept",
      actor_id: "owner-pending",
      detail: JSON.stringify({ version: CURRENT_POLICY_VERSION }),
    });
  });

  it("surfaces discreet Discord invite guidance on browser OAuth guild rejection and blocks state replay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "tok" });
        if (url.endsWith("/users/@me")) return Response.json({ id: "d1", username: "newbie" });
        if (url.endsWith("/users/@me/guilds")) return Response.json([{ id: "999999999999999999" }]);
        throw new Error(`unexpected ${url}`);
      }),
    );

    const flowRes = await api("/api/v1/auth/flows", undefined, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ mode: "browser" }),
    });
    expect(flowRes.status).toBe(201);
    const flow = (await flowRes.json()) as { state: string };

    const cb = await api(`/api/v1/auth/callback?state=${encodeURIComponent(flow.state)}&code=abc`);
    expect(cb.status).toBe(400);
    const html = await cb.text();
    expect(html).toContain("你的账号不在允许的 Discord 服务器中");
    expect(html).toContain(DEFAULT_COMMUNITY_INVITE_URL);
    expect(html).toContain('"type":"oauth-error"');

    // Replaying the errored state is rejected immediately
    const replay = await api(`/api/v1/auth/callback?state=${encodeURIComponent(flow.state)}&code=abc`);
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("登录状态无效或已过期");
  });
});

describe("collections & author showcase", () => {
  it("supports collection CRUD, enforces same-author ownership, hides private items, and reuses catalogue filters", async () => {
    await seedUser({ id: "author-1", acceptedVersion: CURRENT_POLICY_VERSION, token: "a1-token" });
    await seedUser({ id: "author-2", acceptedVersion: CURRENT_POLICY_VERSION, token: "a2-token" });

    await seedPublishedProject({
      id: "p-pub-role",
      authorId: "author-1",
      title: "公开角色模组",
      visibility: "public",
      projectType: "角色",
      tags: ["奇幻"],
    });
    await seedPublishedProject({
      id: "p-pub-event",
      authorId: "author-1",
      title: "公开事件模组",
      visibility: "public",
      projectType: "事件",
      tags: ["日常"],
    });
    await seedPublishedProject({
      id: "p-private",
      authorId: "author-1",
      title: "私有模组",
      visibility: "private",
      projectType: "角色",
    });
    await seedPublishedProject({
      id: "p-other-author",
      authorId: "author-2",
      title: "他人模组",
      visibility: "public",
      projectType: "角色",
    });

    // Cannot add another author's project to own collection
    const forbiddenCreate = await api("/api/v1/collections", "a1-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "越权合集",
        description: "尝试收入他人项目",
        projectIds: ["p-other-author"],
      }),
    });
    expect(forbiddenCreate.status).toBe(403);

    // Collection with only private project is hidden from public endpoints
    const privateOnlyRes = await api("/api/v1/collections", "a1-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "草稿私藏",
        description: "仅私有项目",
        projectIds: ["p-private"],
      }),
    });
    expect(privateOnlyRes.status).toBe(201);
    const privateOnly = (await privateOnlyRes.json()) as { id: string; publicProjectCount: number };
    expect(privateOnly.publicProjectCount).toBe(0);
    expect((await api(`/api/v1/collections/${privateOnly.id}`)).status).toBe(404);

    // Public collection with 1 public + 1 private project counts only public projects publicly
    const colRes = await api("/api/v1/collections", "a1-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "北境编年史系列",
        description: "北境世界线配套角色与事件",
        projectIds: ["p-pub-role", "p-private"],
      }),
    });
    expect(colRes.status).toBe(201);
    const col = (await colRes.json()) as { id: string; publicProjectCount: number; projectIds: string[] };
    expect(col.publicProjectCount).toBe(1);
    expect(col.projectIds).toEqual(["p-pub-role", "p-private"]);

    // Assign second public project via PUT /api/v1/projects/:id/collections
    const assignRes = await api("/api/v1/projects/p-pub-event/collections", "a1-token", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collectionIds: [col.id] }),
    });
    expect(assignRes.status).toBe(200);

    // ProjectDetail includes public collection badge with projectCount = 2
    const detailRes = await api("/api/v1/projects/p-pub-role");
    expect(detailRes.status).toBe(200);
    await expect(detailRes.json()).resolves.toMatchObject({
      id: "p-pub-role",
      collections: [
        {
          id: col.id,
          title: "北境编年史系列",
          description: "北境世界线配套角色与事件",
          projectCount: 2,
        },
      ],
    });

    // Public collection summary & author profile endpoints
    const publicColRes = await api(`/api/v1/collections/${col.id}`);
    expect(publicColRes.status).toBe(200);
    await expect(publicColRes.json()).resolves.toMatchObject({
      id: col.id,
      title: "北境编年史系列",
      projectCount: 2,
      author: { id: "author-1", name: "Name author-1" },
    });

    const authorProfileRes = await api("/api/v1/authors/author-1");
    expect(authorProfileRes.status).toBe(200);
    const authorProfile = (await authorProfileRes.json()) as {
      projectCount: number;
      collections: Array<{ id: string; projectCount: number }>;
    };
    expect(authorProfile.projectCount).toBe(2);
    expect(authorProfile.collections).toEqual([expect.objectContaining({ id: col.id, projectCount: 2 })]);

    // Catalogue filtering by collectionId (and combined with projectType filter!)
    const allInColRes = await api(`/api/v1/projects?collectionId=${encodeURIComponent(col.id)}`);
    expect(allInColRes.status).toBe(200);
    const allInCol = (await allInColRes.json()) as { total: number; items: Array<{ id: string }> };
    expect(allInCol.total).toBe(2);
    expect(allInCol.items.map((item) => item.id).sort()).toEqual(["p-pub-event", "p-pub-role"]);

    const roleInColRes = await api(
      `/api/v1/projects?collectionId=${encodeURIComponent(col.id)}&projectType=${encodeURIComponent("角色")}`,
    );
    expect(roleInColRes.status).toBe(200);
    const roleInCol = (await roleInColRes.json()) as { total: number; items: Array<{ id: string }> };
    expect(roleInCol.total).toBe(1);
    expect(roleInCol.items[0]?.id).toBe("p-pub-role");

    // Soft-deleting collection removes it from public endpoints without deleting projects
    const delRes = await api(`/api/v1/collections/${col.id}`, "a1-token", { method: "DELETE" });
    expect(delRes.status).toBe(204);
    expect((await api(`/api/v1/collections/${col.id}`)).status).toBe(404);
    expect((await api("/api/v1/projects/p-pub-role")).status).toBe(200);
  });
});
