import { env, SELF } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import type { AuthorCollectionListResponse } from "@workshop/contracts";
import { COLLECTION_LIMITS, CURRENT_POLICY_VERSION } from "@workshop/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { authorSetProjectCollections } from "../src/data/collection-operations";
import type { DataEnv } from "../src/data/env";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const ORIGIN = "https://workshop.test";
const now = "2026-11-18T00:00:00.000Z";
const originalCacheTtl = bindings.CACHE_TTL_PUBLIC_SECONDS;

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
  bindings.CACHE_TTL_PUBLIC_SECONDS = "0";
});

afterAll(() => {
  bindings.CACHE_TTL_PUBLIC_SECONDS = originalCacheTtl;
});

beforeEach(async () => {
  await bindings.DB.exec(
    "DELETE FROM audit_events; DELETE FROM collection_projects; DELETE FROM collections; DELETE FROM project_likes; DELETE FROM project_subscriptions; DELETE FROM download_daily_stats; UPDATE projects SET working_version_id = NULL, published_version_id = NULL, published_cover_asset_id = NULL; DELETE FROM project_search_tags; DELETE FROM assets; DELETE FROM project_versions; DELETE FROM projects; DELETE FROM sessions; DELETE FROM users;",
  );
});

describe("policy acceptance & quiz gate", () => {
  it("blocks unaccepted and outdated-version sessions with 403 until the 3-question quiz is passed", async () => {
    await seedUser({ id: "owner-pending", role: "owner", acceptedVersion: null, token: "pending-token" });
    await seedUser({ id: "member-outdated", role: "member", acceptedVersion: "2025-01", token: "outdated-token" });
    await seedUser({ id: "author-ok", role: "member", acceptedVersion: CURRENT_POLICY_VERSION, token: "author-token" });
    await seedPublishedProject({ id: "pub-1", authorId: "author-ok", title: "测试世界模组" });

    // Guest browsing still works even with no token or unaccepted session
    expect((await api("/api/v1/projects/pub-1")).status).toBe(200);
    expect((await api("/api/v1/me/projects", "outdated-token")).status).toBe(403);

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
      projectType: "内容扩展",
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

    // Control characters in collection metadata are rejected
    expect(
      (
        await api("/api/v1/collections", "a1-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "含控制符\u0000" }),
        })
      ).status,
    ).toBe(400);

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

    // Cursor scope isolates collectionId so a collection cursor cannot be replayed on the global catalogue
    const pagedColRes = await api(`/api/v1/projects?collectionId=${encodeURIComponent(col.id)}&limit=1`);
    expect(pagedColRes.status).toBe(200);
    const { nextCursor } = (await pagedColRes.json()) as { nextCursor: string | null };
    expect(nextCursor).toBeTruthy();
    expect((await api(`/api/v1/projects?limit=1&cursor=${encodeURIComponent(nextCursor!)}`)).status).toBe(400);

    // Soft-deleting collection removes it from public endpoints without deleting projects
    const delRes = await api(`/api/v1/collections/${col.id}`, "a1-token", { method: "DELETE" });
    expect(delRes.status).toBe(204);
    expect((await api(`/api/v1/collections/${col.id}`)).status).toBe(404);
    expect((await api("/api/v1/projects/p-pub-role")).status).toBe(200);
  });
});

describe("project collection replacement races", () => {
  const authorId = "collection-author";
  const token = "collection-author-token";
  const projectId = "moving-project";

  beforeEach(async () => {
    await seedUser({ id: authorId, acceptedVersion: CURRENT_POLICY_VERSION, token });
    await bindings.DB.batch([
      bindings.DB.prepare("INSERT INTO projects (id, author_id) VALUES (?, ?)").bind(projectId, authorId),
      bindings.DB.prepare(`
        INSERT INTO project_versions (id, project_id, version_no, title, project_type, created_by)
        VALUES ('moving-project-v1', ?, 1, 'Moving project', '角色', ?)
      `).bind(projectId, authorId),
      bindings.DB.prepare("UPDATE projects SET working_version_id = 'moving-project-v1' WHERE id = ?").bind(projectId),
      bindings.DB.prepare(`
        INSERT INTO collections (id, author_id, title, created_at, updated_at)
        VALUES ('collection-a', ?1, 'A', ?2, ?2), ('collection-b', ?1, 'B', ?2, ?2), ('collection-c', ?1, 'C', ?2, ?2)
      `).bind(authorId, now),
      bindings.DB.prepare(`
        INSERT INTO collection_projects (collection_id, project_id, added_at) VALUES ('collection-a', ?, ?)
      `).bind(projectId, now),
    ]);
  });

  async function replace(id: string, collectionIds: string[], beforeBatch?: () => Promise<void>) {
    const request = new Request(new URL(`/api/v1/projects/${id}/collections`, ORIGIN), {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ collectionIds }),
    });
    if (!beforeBatch) return SELF.fetch(request);

    // Submit the competing request before the real D1 batch, not on a timer.
    // The PUT still runs the HTTP handler, data operation, and real SQL.
    let intercepted = false;
    const db = new Proxy(bindings.DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            expect(intercepted).toBe(false);
            intercepted = true;
            await beforeBatch();
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const context = {
      exports: {
        DataService: {
          identitySession: (token: string) => workerExports.DataService.identitySession(token),
          authorSetProjectCollections: (authorization: string | undefined, id: string, ids: string[]) =>
            authorSetProjectCollections({ ...bindings, DB: db }, authorization, id, ids),
        },
      },
    } as unknown as ExecutionContext;
    const response = await app.fetch(request, bindings, context);
    expect(intercepted).toBe(true);
    return response;
  }

  async function readCollections() {
    const response = await api("/api/v1/me/collections", token);
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as AuthorCollectionListResponse;
    return Object.fromEntries(
      items.map((item) => [item.id, { projectIds: item.projectIds, updatedAt: item.updatedAt }]),
    );
  }

  it("keeps the original memberships when a requested collection is deleted before the replacement", async () => {
    const response = await replace(projectId, ["collection-b", "collection-c"], async () => {
      expect((await api("/api/v1/collections/collection-b", token, { method: "DELETE" })).status).toBe(204);
    });

    expect(response.status).toBe(403);
    expect(await readCollections()).toEqual({
      "collection-a": { projectIds: [projectId], updatedAt: now },
      "collection-c": { projectIds: [], updatedAt: now },
    });
    const deletedMembership = await bindings.DB.prepare(
      "SELECT project_id FROM collection_projects WHERE collection_id = 'collection-b'",
    ).first();
    expect(deletedMembership).toBeNull();
    expect(
      await bindings.DB.prepare("SELECT id FROM audit_events WHERE action = 'collection.update'").first(),
    ).toBeNull();
  });

  it("returns not found for a deleted project even when a requested collection was also deleted", async () => {
    const response = await replace(projectId, ["collection-b"], async () => {
      const deletion = await api(`/api/v1/projects/${projectId}`, token, {
        method: "DELETE",
        headers: { "if-match": "1" },
      });
      expect(deletion.status).toBe(204);
      expect((await api("/api/v1/collections/collection-b", token, { method: "DELETE" })).status).toBe(204);
    });

    expect(response.status).toBe(404);
    expect(await readCollections()).toEqual({
      "collection-a": { projectIds: [], updatedAt: now },
      "collection-c": { projectIds: [], updatedAt: now },
    });
  });

  it("leaves exactly the last replacement, not the union of racing replacements", async () => {
    const response = await replace(projectId, ["collection-c"], async () => {
      const competing = await replace(projectId, ["collection-b"]);
      expect(competing.status).toBe(200);
      expect(await competing.json()).toEqual({ collectionIds: ["collection-b"] });
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ collectionIds: ["collection-c"] });
    const collections = await readCollections();
    expect(Object.fromEntries(Object.entries(collections).map(([id, item]) => [id, item.projectIds]))).toEqual({
      "collection-a": [],
      "collection-b": [],
      "collection-c": [projectId],
    });
  });

  it("keeps the original memberships when another project takes the last available spot", async () => {
    const limit = COLLECTION_LIMITS.maxProjectsPerCollection;
    const fillers = Array.from({ length: limit - 1 }, (_, index) => `filler-${index}`);
    await bindings.DB.batch([
      bindings.DB.prepare("INSERT INTO projects (id, author_id) VALUES ('capacity-winner', ?)").bind(authorId),
      bindings.DB.prepare("INSERT INTO projects (id, author_id) SELECT value, ? FROM json_each(?)").bind(
        authorId,
        JSON.stringify(fillers),
      ),
      bindings.DB.prepare(`
        INSERT INTO collection_projects (collection_id, project_id, position, added_at)
        SELECT 'collection-b', value, key, ? FROM json_each(?)
      `).bind(now, JSON.stringify(fillers)),
    ]);

    const response = await replace(projectId, ["collection-b", "collection-c"], async () => {
      expect((await replace("capacity-winner", ["collection-b"])).status).toBe(200);
    });

    expect(response.status).toBe(400);
    const collections = await readCollections();
    expect(collections["collection-a"]).toEqual({ projectIds: [projectId], updatedAt: now });
    expect(collections["collection-b"]?.projectIds).toEqual([...fillers, "capacity-winner"]);
    expect(collections["collection-c"]).toEqual({ projectIds: [], updatedAt: now });
  });
});
