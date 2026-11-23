import { env, SELF } from "cloudflare:test";
import {
  homeResponseSchema,
  projectListQuerySchema,
  projectPreviewSchema,
  siteSettingsSchema,
} from "@workshop/contracts";
import { CURRENT_POLICY_VERSION } from "@workshop/domain";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { download } from "../src/data/download";
import type { DataEnv } from "../src/data/env";
import { getProjectEntryIndex } from "../src/storage/content-index";
import { getBanner } from "../src/storage/home";
import { listPublishedProjects } from "../src/storage/projects";
import { hashSessionToken } from "../src/storage/session-hash";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const now = "2026-10-21T00:00:00.000Z";

beforeAll(async () => {
  await applySchema(bindings.DB);
});

beforeEach(async () => {
  await bindings.DB.exec(`
    DELETE FROM recommendations;
    DELETE FROM site_settings;
    DELETE FROM download_daily_stats;
    UPDATE projects SET working_version_id = NULL, published_version_id = NULL, published_cover_asset_id = NULL;
    DELETE FROM assets;
    DELETE FROM project_versions;
    DELETE FROM projects;
    DELETE FROM users;
  `);
});

async function seed() {
  await bindings.DB.prepare(
    "INSERT INTO users (id, username, global_name, avatar, role, policy_accepted_version, policy_accepted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'member', ?, ?, ?, ?)",
  )
    .bind("u1", "author", "作者", "avatar.png", CURRENT_POLICY_VERSION, now, now, now)
    .run();

  await bindings.DB.prepare(`
    INSERT INTO projects
      (id, author_id, visibility, published_at, updated_at,
       downloads_count, likes_count, subscriptions_count)
    VALUES (?, ?, 'public', ?, ?, 12, 3, 2)
  `)
    .bind("p1", "u1", now, now)
    .run();

  await bindings.DB.prepare(`
    INSERT INTO project_versions
      (id, project_id, version_no, title, description, project_type, included_types,
       tags, worldbook_count, regex_count, schema_version, discord_thread_url, created_by, created_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, 12, 4, '4.3', 'https://discord.com/channels/1/2', ?, ?)
  `)
    .bind("r1", "p1", "命定之诗测试项目", "公开描述", "系统核心", '["角色","规则扩展"]', '["奇幻","测试"]', "u1", now)
    .run();

  await bindings.DB.prepare(`
    INSERT INTO project_versions (id, project_id, version_no, title, project_type, created_by, created_at)
    VALUES ('r3', 'p1', 2, '草稿', '系统核心', 'u1', ?)
  `)
    .bind(now)
    .run();
  await bindings.DB.prepare(
    "UPDATE projects SET working_version_id = 'r3', published_version_id = 'r1' WHERE id = 'p1'",
  ).run();

  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('cover1', 'p1', 'r1', 'cover', 'covers/p1.webp', ?, 100, 'image/webp', ?)
  `)
    .bind("0".repeat(64), now)
    .run();
  await bindings.R2.put("covers/p1.webp", new Uint8Array([1, 2, 3]));
  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('cover3', 'p1', 'r3', 'cover', 'covers/p1/r3-cover.webp', ?, 3, 'image/webp', ?)
  `)
    .bind("3".repeat(64), now)
    .run();
  await bindings.R2.put("covers/p1/r3-cover.webp", new Uint8Array([4, 5, 6]));

  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('worldbook1', 'p1', 'r1', 'worldbook', 'projects/p1/versions/r1/worldbook.json', ?, 20, 'application/json', ?)
  `)
    .bind(crypto.randomUUID().replaceAll("-", "").repeat(2), now)
    .run();
  await bindings.R2.put("projects/p1/versions/r1/worldbook.json", '{"entries":[]}');

  const tokenHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("test-token")))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  await bindings.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at, last_seen_at)
    VALUES (?, 'u1', 1, '2099-01-01T00:00:00.000Z', ?, ?)
  `)
    .bind(tokenHash, now, now)
    .run();
  await bindings.DB.prepare(
    "INSERT INTO users (id, username, role, policy_accepted_version, policy_accepted_at, created_at, updated_at) VALUES ('u2', 'other', 'member', ?, ?, ?, ?)",
  )
    .bind(CURRENT_POLICY_VERSION, now, now, now)
    .run();
  const otherHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("other-token")))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  await bindings.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at, last_seen_at)
    VALUES (?, 'u2', 1, '2099-01-01T00:00:00.000Z', ?, ?)
  `)
    .bind(otherHash, now, now)
    .run();

  await bindings.DB.prepare(`
    INSERT INTO projects
      (id, author_id, visibility, published_at, updated_at)
    VALUES ('p2', 'u1', 'private', ?, ?)
  `)
    .bind(now, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO project_versions (id, project_id, version_no, title, project_type, created_by, created_at)
    VALUES ('r2', 'p2', 1, '私有项目', '角色', 'u1', ?)
  `)
    .bind(now)
    .run();
  await bindings.DB.prepare(
    "UPDATE projects SET working_version_id = 'r2', published_version_id = 'r2' WHERE id = 'p2'",
  ).run();
  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('cover2', 'p2', 'r2', 'cover', 'covers/p2/r2-cover.webp', ?, 3, 'image/webp', ?)
  `)
    .bind("2".repeat(64), now)
    .run();
  await bindings.R2.put("covers/p2/r2-cover.webp", new Uint8Array([7, 8, 9]));

  await bindings.DB.prepare(`
    INSERT INTO recommendations (id, curator_id, project_id, project_version_id, comment, created_at, updated_at)
    VALUES ('rec1', 'u1', 'p1', 'r1', '推荐语', ?, ?)
  `)
    .bind(now, now)
    .run();

  await bindings.DB.prepare(`
    INSERT INTO site_settings (key, value, updated_at) VALUES ('discover_banner', ?, ?)
  `)
    .bind(
      JSON.stringify({
        imageUrl: null,
        positionX: 40,
        positionY: 50,
        zoom: 1,
        mobilePositionX: 40,
        mobilePositionY: 50,
        mobileZoom: 1,
      }),
      now,
    )
    .run();
}

describe("public read path", () => {
  it("lists only published public projects", async () => {
    await seed();
    const response = await SELF.fetch(new URL("/api/v1/projects", "https://workshop.test").toString(), undefined);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: "p1",
      title: "命定之诗测试项目",
      projectType: "系统核心",
      includedTypes: ["角色", "规则扩展"],
      entries: { worldbook: 12, regex: 4 },
      schemaVersion: "4.3",
      counts: { downloads: 12, likes: 3, subscriptions: 2 },
      coverUrl: "/api/v1/public-assets/covers/p1.webp",
    });
  });

  it("returns a canonical batch of public projects and missing ids", async () => {
    await seed();
    const response = await SELF.fetch("https://workshop.test/api/v1/projects/batch?ids=p2%2C%20p1%20%2Cmissing%2Cp1");
    expect(response.status).toBe(200);
    const result = await response.json<{ items: Array<{ id: string }>; missingIds: string[] }>();
    expect(result.items.map((item) => item.id)).toEqual(["p1"]);
    expect(result.missingIds).toEqual(["missing", "p2"]);
    expect(response.headers.get("cache-control")).toContain("public");
  });

  it("rejects malformed batch queries without caching them", async () => {
    const tooMany = Array.from({ length: 51 }, (_, index) => `p${index}`).join(",");
    for (const query of ["", "?ids=", "?ids=p1,,p2", "?ids=p1&ids=p2", "?ids=p1&extra=x", `?ids=${tooMany}`]) {
      const response = await SELF.fetch(`https://workshop.test/api/v1/projects/batch${query}`);
      expect(response.status, query).toBe(400);
      expect(response.headers.get("cache-control"), query).toContain("no-store");
    }
  });

  it("keeps a usable home list when discovery fails and never caches the partial response", async () => {
    await seed();
    await bindings.DB.exec("ALTER TABLE recommendation_batches RENAME TO recommendation_batches_test_hidden");
    try {
      const response = await SELF.fetch("https://workshop.test/api/v1/home");
      const home = homeResponseSchema.parse(await response.json());
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(home.discovery).toMatchObject({
        ok: false,
        error: { code: "internal", message: "Discovery unavailable" },
      });
      expect(home.projects).toMatchObject({ ok: true, data: { items: [{ id: "p1" }] } });
    } finally {
      await bindings.DB.exec("ALTER TABLE recommendation_batches_test_hidden RENAME TO recommendation_batches");
    }
  });

  it("returns a no-store error when all home sections fail", async () => {
    await seed();
    await bindings.DB.exec("ALTER TABLE site_settings RENAME TO site_settings_test_hidden");
    await bindings.DB.exec("ALTER TABLE recommendation_batches RENAME TO recommendation_batches_test_hidden");
    await bindings.DB.exec("ALTER TABLE projects RENAME TO projects_test_hidden");
    try {
      const response = await SELF.fetch("https://workshop.test/api/v1/home");
      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toContain("no-store");
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "internal", message: "Home unavailable" },
      });
      const site = await SELF.fetch("https://workshop.test/api/v1/site");
      expect(site.status).toBe(500);
      expect(site.headers.get("cache-control")).toContain("no-store");
      expect(site.headers.get("access-control-allow-origin")).toBe("*");
      await expect(site.json()).resolves.toMatchObject({
        error: { code: "internal", message: "Internal server error" },
      });
    } finally {
      await bindings.DB.exec("ALTER TABLE projects_test_hidden RENAME TO projects");
      await bindings.DB.exec("ALTER TABLE recommendation_batches_test_hidden RENAME TO recommendation_batches");
      await bindings.DB.exec("ALTER TABLE site_settings_test_hidden RENAME TO site_settings");
    }
  });

  it("maps D1 daily quota exhaustion to a friendly no-store 503 without leaking D1_ERROR", async () => {
    await seed();
    const originalPrepare = bindings.DB.prepare.bind(bindings.DB);
    bindings.DB.prepare = (() => {
      throw new Error(
        "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.",
      );
    }) as typeof bindings.DB.prepare;
    try {
      const home = await SELF.fetch("https://workshop.test/api/v1/home");
      expect(home.status).toBe(503);
      expect(home.headers.get("cache-control")).toContain("no-store");
      const homeBody = (await home.json()) as { error: { code: string; message: string; details?: string } };
      expect(homeBody.error.code).toBe("quota_exceeded");
      expect(homeBody.error.message).toContain("08:00");
      expect(homeBody.error.message).not.toContain("免费");
      expect(homeBody.error.message).not.toContain("D1_ERROR");
      expect(homeBody.error.details).toBeUndefined();

      const projects = await SELF.fetch("https://workshop.test/api/v1/projects?search=quota-miss");
      expect(projects.status).toBe(503);
      expect(projects.headers.get("cache-control")).toContain("no-store");
      const projectsBody = (await projects.json()) as { error: { code: string; details?: string } };
      expect(projectsBody.error.code).toBe("quota_exceeded");
      expect(projectsBody.error.details).toBeUndefined();

      const me = await SELF.fetch("https://workshop.test/api/v1/me", {
        headers: { authorization: "Bearer probe-token" },
      });
      expect(me.status).toBe(503);
      await expect(me.json()).resolves.toMatchObject({
        error: { code: "quota_exceeded" },
      });
    } finally {
      bindings.DB.prepare = originalPrepare;
    }

    // Generic SQLITE_TOOBIG or SQL LIMIT syntax errors must not misclassify as quota_exceeded
    const { isStorageQuotaError } = await import("../src/quota-error");
    expect(isStorageQuotaError(new Error("D1_ERROR: string or blob too big: SQLITE_TOOBIG"))).toBe(false);
    expect(isStorageQuotaError(new Error('D1_ERROR: near "LIMIT": syntax error'))).toBe(false);
    expect(isStorageQuotaError(new Error("D1_ERROR: row size limit exceeded"))).toBe(false);
  });

  it("serves only published public preview text to authenticated readers", async () => {
    await seed();
    await bindings.DB.prepare(
      `UPDATE project_versions SET entry_index = '{"schemaVersion":1,"entries":[]}' WHERE id = 'r1'`,
    ).run();
    await bindings.R2.put(
      "projects/p1/versions/r1/worldbook.json",
      JSON.stringify({ entries: [{ uid: 7, name: "Greeting", content: "<p>hello</p>" }] }),
    );
    const response = await SELF.fetch(
      new URL("/api/v1/projects/p1/preview/worldbook", "https://workshop.test").toString(),
      { headers: { authorization: "Bearer test-token" } },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      versionId: "r1",
      kind: "worldbook",
      entries: [{ key: "uid:7", name: "Greeting", content: "<p>hello</p>" }],
    });
    const privateResponse = await SELF.fetch(
      new URL("/api/v1/projects/p2/preview/worldbook", "https://workshop.test").toString(),
      { headers: { authorization: "Bearer test-token" } },
    );
    expect(privateResponse.status).toBe(404);
  });

  it("checks current session and publication before each fixed preview", async () => {
    await seed();
    await bindings.DB.prepare(
      `UPDATE project_versions SET entry_index = '{"schemaVersion":1,"entries":[]}' WHERE id IN ('r1', 'r3')`,
    ).run();
    await bindings.R2.put("projects/p1/versions/r1/worldbook.json", '{"entries":[{"uid":1,"content":"first"}]}');
    const url = "https://workshop.test/api/v1/projects/p1/preview/worldbook";
    const request = (token: string) => SELF.fetch(url, { headers: { authorization: `Bearer ${token}` } });
    for (const token of ["test-token", "other-token"]) {
      const response = await request(token);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      await expect(response.json()).resolves.toMatchObject({ versionId: "r1", entries: [{ content: "first" }] });
    }
    await bindings.DB.prepare("DELETE FROM sessions WHERE user_id = 'u1'").run();
    expect((await request("test-token")).status).toBe(401);
    await bindings.DB.prepare("UPDATE projects SET visibility = 'private' WHERE id = 'p1'").run();
    expect((await request("other-token")).status).toBe(404);
    await bindings.DB.prepare(
      "UPDATE projects SET visibility = 'public', published_version_id = 'r3' WHERE id = 'p1'",
    ).run();
    await bindings.DB.prepare(`INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
      VALUES ('worldbook3', 'p1', 'r3', 'worldbook', 'projects/p1/versions/r3/worldbook.json', ?, 20, 'application/json', ?)`)
      .bind("2".repeat(64), now)
      .run();
    await bindings.R2.put("projects/p1/versions/r3/worldbook.json", '{"entries":[{"uid":2,"content":"second"}]}');
    const changed = await request("other-token");
    expect(changed.status).toBe(200);
    await expect(changed.json()).resolves.toMatchObject({ versionId: "r3", entries: [{ content: "second" }] });
    await bindings.DB.prepare("UPDATE assets SET sha256 = ? WHERE id = 'worldbook3'").bind("4".repeat(64)).run();
    await bindings.R2.put("projects/p1/versions/r3/worldbook.json", "invalid JSON");
    expect((await request("other-token")).status).toBe(404);
    await bindings.DB.prepare("UPDATE assets SET sha256 = ? WHERE id = 'worldbook3'").bind("5".repeat(64)).run();
    await bindings.R2.delete("projects/p1/versions/r3/worldbook.json");
    expect((await request("other-token")).status).toBe(404);
  });

  it("returns only allowlisted behavior fields without inventing source defaults", async () => {
    await seed();
    await bindings.DB.prepare(
      `UPDATE project_versions SET entry_index = '{"schemaVersion":1,"entries":[]}' WHERE id = 'r1'`,
    ).run();
    await bindings.R2.put(
      "projects/p1/versions/r1/worldbook.json",
      JSON.stringify({
        entries: [
          {
            uid: 1,
            key: ["legacy", 7],
            keysecondary: ["secondary"],
            constant: false,
            selective: true,
            selectiveLogic: 2,
            position: 4,
            order: 12,
            depth: 3,
            disable: true,
            content: "plain",
            arbitraryCode: "never expose",
          },
          {
            uid: 2,
            strategy: { type: "selective", keys: ["helper"], keys_secondary: { keys: ["other"], logic: "and_all" } },
            position: { type: "at_depth", role: "user", order: 9, depth: 2 },
            enabled: true,
          },
          { uid: 3 },
        ],
      }),
    );
    const response = await SELF.fetch(
      new URL("/api/v1/projects/p1/preview/worldbook", "https://workshop.test").toString(),
      { headers: { authorization: "Bearer test-token" } },
    );
    expect(response.status).toBe(200);
    const body = projectPreviewSchema.parse(await response.json());
    expect(body.entries[0]?.behavior).toEqual({
      kind: "worldbook",
      keys: ["legacy"],
      secondaryKeys: ["secondary"],
      strategy: null,
      constant: false,
      selective: true,
      selectiveLogic: 2,
      position: 4,
      role: null,
      outletName: null,
      order: 12,
      depth: 3,
      enabled: false,
    });
    expect(body.entries[1]?.behavior).toMatchObject({
      keys: ["helper"],
      secondaryKeys: ["other"],
      strategy: "selective",
      selectiveLogic: "and_all",
      position: "at_depth",
      role: "user",
      order: 9,
      depth: 2,
      enabled: true,
    });
    expect(body.entries[2]?.behavior).toMatchObject({
      position: null,
      order: null,
      depth: null,
      enabled: null,
      strategy: null,
    });
    expect(JSON.stringify(body)).not.toContain("arbitraryCode");
    expect(
      projectPreviewSchema.safeParse({
        versionId: "old",
        kind: "worldbook",
        entries: [{ key: "old", name: "Old", content: "text" }],
      }).success,
    ).toBe(true);
  });

  it("keeps regex patterns and replacement code as display text", async () => {
    await seed();
    await bindings.DB.prepare(
      `UPDATE project_versions SET entry_index = '{"schemaVersion":1,"entries":[]}', regex_count = 1 WHERE id = 'r1'`,
    ).run();
    await bindings.DB.prepare(`INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
      VALUES ('regex1', 'p1', 'r1', 'regex', 'projects/p1/versions/r1/regex.json', ?, 20, 'application/json', ?)`)
      .bind("4".repeat(64), now)
      .run();
    const source = "<script>throw new Error('must not run')</script>😀";
    await bindings.R2.put(
      "projects/p1/versions/r1/regex.json",
      JSON.stringify([
        {
          id: "regex1",
          scriptName: "Display",
          findRegex: "[invalid(",
          disabled: true,
          replaceString: source,
          arbitraryCode: "never expose",
        },
      ]),
    );
    const response = await SELF.fetch(
      new URL("/api/v1/projects/p1/preview/regex", "https://workshop.test").toString(),
      { headers: { authorization: "Bearer test-token" } },
    );
    expect(response.status).toBe(200);
    const body = projectPreviewSchema.parse(await response.json());
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      content: source,
      behavior: {
        kind: "regex",
        scriptName: "Display",
        findRegex: "[invalid(",
        disabled: true,
        replacementLength: Array.from(source).length,
      },
    });
    expect(JSON.stringify(body)).not.toContain("arbitraryCode");
  });

  it("returns empty previews for absent zero-count content but not missing expected assets", async () => {
    await seed();
    await bindings.DB.prepare(
      `UPDATE project_versions SET entry_index = '{"schemaVersion":1,"entries":[]}', regex_count = 0 WHERE id = 'r1'`,
    ).run();
    const empty = await SELF.fetch(new URL("/api/v1/projects/p1/preview/regex", "https://workshop.test").toString(), {
      headers: { authorization: "Bearer test-token" },
    });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ versionId: "r1", kind: "regex", entries: [] });
    await bindings.DB.prepare("UPDATE project_versions SET regex_count = 1 WHERE id = 'r1'").run();
    const missing = await SELF.fetch(new URL("/api/v1/projects/p1/preview/regex", "https://workshop.test").toString(), {
      headers: { authorization: "Bearer test-token" },
    });
    expect(missing.status).toBe(404);
    const hidden = await SELF.fetch(new URL("/api/v1/projects/p2/preview/regex", "https://workshop.test").toString(), {
      headers: { authorization: "Bearer test-token" },
    });
    expect(hidden.status).toBe(404);
  });

  it("filters by author id and returns an empty page for others", async () => {
    await seed();
    const mine = await SELF.fetch(
      new URL("/api/v1/projects?authorId=u1", "https://workshop.test").toString(),
      undefined,
    );
    expect(mine.status).toBe(200);
    await expect(mine.json()).resolves.toMatchObject({ items: [{ id: "p1", author: { id: "u1" } }] });
    const other = await SELF.fetch(
      new URL("/api/v1/projects?authorId=u2", "https://workshop.test").toString(),
      undefined,
    );
    expect(other.status).toBe(200);
    await expect(other.json()).resolves.toMatchObject({ items: [], nextCursor: null });
  });

  it("keeps the public list within a bounded rows-read budget", async () => {
    await seed();
    const meta = { rows_read: Infinity, rows_written: Infinity };
    const page = await listPublishedProjects(
      bindings.DB,
      projectListQuerySchema.parse({ limit: 24, sort: "updated" }),
      undefined,
      (value) => {
        meta.rows_read = value.rows_read;
        meta.rows_written = value.rows_written;
      },
    );
    expect(page.items.length).toBeGreaterThan(0);
    expect(meta.rows_read).toBeLessThan(200);
    expect(meta.rows_written).toBe(0);
  });

  it("paginates with a stable keyset cursor", async () => {
    await seed();
    for (const [projectId, versionId, updatedAt] of [
      ["p3", "r4", "2026-10-20T00:00:00.000Z"],
      ["p4", "r5", "2026-10-19T00:00:00.000Z"],
    ] as const) {
      await bindings.DB.prepare(`
        INSERT INTO projects
          (id, author_id, visibility, published_at, updated_at)
        VALUES (?, 'u1', 'public', ?, ?)
      `)
        .bind(projectId, updatedAt, updatedAt)
        .run();
      await bindings.DB.prepare(`
        INSERT INTO project_versions (id, project_id, version_no, title, project_type, created_by, created_at)
        VALUES (?, ?, 1, ?, '角色', 'u1', ?)
      `)
        .bind(versionId, projectId, projectId, updatedAt)
        .run();
      await bindings.DB.prepare("UPDATE projects SET published_version_id = ? WHERE id = ?")
        .bind(versionId, projectId)
        .run();
    }
    const first = await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({ limit: 2, sort: "updated" }));
    expect(first.items.map((item) => item.id)).toEqual(["p1", "p3"]);
    expect(first.nextCursor).toBeTruthy();
    const second = await listPublishedProjects(
      bindings.DB,
      projectListQuerySchema.parse({ limit: 2, sort: "updated", cursor: first.nextCursor! }),
    );
    expect(second.items.map((item) => item.id)).toEqual(["p4"]);
    expect(second.nextCursor).toBeNull();
  });

  it("filters by exact tag", async () => {
    await seed();
    const tagged = await SELF.fetch(
      new URL(`/api/v1/projects?tag=${encodeURIComponent("奇幻")}`, "https://workshop.test").toString(),
      undefined,
    );
    expect(tagged.status).toBe(200);
    await expect(tagged.json()).resolves.toMatchObject({ items: [{ id: "p1" }] });
    const missing = await SELF.fetch(
      new URL(`/api/v1/projects?tag=${encodeURIComponent("不存在")}`, "https://workshop.test").toString(),
      undefined,
    );
    await expect(missing.json()).resolves.toMatchObject({ items: [] });
  });

  it("supports one- and two-character search across title, tags and author", async () => {
    await seed();
    for (const query of ["命", "命定", "奇幻", "作者", "命定之"]) {
      const response = await SELF.fetch(
        new URL(`/api/v1/projects?search=${encodeURIComponent(query)}`, "https://workshop.test").toString(),
        undefined,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: Array<{ id: string }> };
      expect(body.items.map((item) => item.id)).toEqual(["p1"]);
    }
    for (const query of ['"', "'", "-"]) {
      const response = await SELF.fetch(
        new URL(`/api/v1/projects?search=${encodeURIComponent(query)}`, "https://workshop.test").toString(),
        undefined,
      );
      expect(response.status).toBe(200);
    }

    // 2-char search uses adjacent phrase ("命定" must not match non-adjacent "命中注定") and "C#" must not wildcard "C"
    await bindings.DB.batch([
      bindings.DB.prepare(
        "INSERT INTO projects (id, author_id, visibility, published_at, updated_at) VALUES ('p-nonadj', 'u1', 'public', ?, ?), ('p-clang', 'u1', 'public', ?, ?), ('p-csharp', 'u1', 'public', ?, ?)",
      ).bind(now, now, now, now, now, now),
      bindings.DB.prepare(
        "INSERT INTO project_versions (id, project_id, version_no, title, project_type, created_by, created_at) VALUES ('r-nonadj', 'p-nonadj', 1, '命中注定', '角色', 'u1', ?), ('r-clang', 'p-clang', 1, 'C语言指南', '角色', 'u1', ?), ('r-csharp', 'p-csharp', 1, 'C#扩展包', '角色', 'u1', ?)",
      ).bind(now, now, now),
      bindings.DB.prepare("UPDATE projects SET published_version_id = 'r-nonadj' WHERE id = 'p-nonadj'"),
      bindings.DB.prepare("UPDATE projects SET published_version_id = 'r-clang' WHERE id = 'p-clang'"),
      bindings.DB.prepare("UPDATE projects SET published_version_id = 'r-csharp' WHERE id = 'p-csharp'"),
    ]);
    const adjRes = await SELF.fetch(
      new URL(`/api/v1/projects?search=${encodeURIComponent("命定")}`, "https://workshop.test").toString(),
    );
    expect(((await adjRes.json()) as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual(["p1"]);

    const csharpRes = await SELF.fetch(
      new URL(`/api/v1/projects?search=${encodeURIComponent("C#")}`, "https://workshop.test").toString(),
    );
    expect(((await csharpRes.json()) as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual(["p-csharp"]);
    const plan = await bindings.DB.prepare(`
      EXPLAIN QUERY PLAN
      SELECT p.id FROM projects p
      WHERE p.rowid IN (SELECT rowid FROM project_search_short WHERE project_search_short MATCH ?)
    `)
      .bind('"命"')
      .all<{ detail: string }>();
    expect(plan.results.some((row) => row.detail.includes("project_search_short"))).toBe(true);
  });

  it("returns project detail and hides private projects", async () => {
    await seed();
    const detail = await SELF.fetch(new URL("/api/v1/projects/p1", "https://workshop.test").toString(), undefined);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      id: "p1",
      discordThreadUrl: "https://discord.com/channels/1/2",
    });

    const hidden = await SELF.fetch(new URL("/api/v1/projects/p2", "https://workshop.test").toString(), undefined);
    expect(hidden.status).toBe(404);
  });

  it("counts logical acquisitions once across retries and file reads", async () => {
    await seed();
    const url = "https://workshop.test/api/v1/projects/p1/downloads";
    expect((await SELF.fetch(url, { method: "POST" })).status).toBe(401);
    const authorDownload = await SELF.fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "Idempotency-Key": crypto.randomUUID() },
    });
    expect(authorDownload.status).toBe(201);
    expect(
      (
        await bindings.DB.prepare("SELECT downloads_count FROM projects WHERE id = 'p1'").first<{
          downloads_count: number;
        }>()
      )?.downloads_count,
    ).toBe(12);
    const headers = { authorization: "Bearer other-token", "Idempotency-Key": crypto.randomUUID() };
    const responses = await Promise.all([
      SELF.fetch(url, { method: "POST", headers }),
      SELF.fetch(url, { method: "POST", headers }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const payload = (await responses[0]!.json()) as { files: Array<{ url: string }> };
    const fileUrl = new URL(payload.files[0]!.url, url).toString();
    expect((await SELF.fetch(fileUrl)).status).toBe(401);
    for (let index = 0; index < 2; index++) {
      const file = await SELF.fetch(fileUrl, { headers });
      expect(file.status).toBe(200);
      expect(await file.text()).toBe('{"entries":[]}');
    }
    const row = await bindings.DB.prepare(
      "SELECT count FROM download_daily_stats WHERE user_id = 'u2' AND project_version_id = 'r1'",
    ).first<{ count: number }>();
    expect(row?.count).toBe(1);
    expect(
      (
        await bindings.DB.prepare("SELECT downloads_count FROM projects WHERE id = 'p1'").first<{
          downloads_count: number;
        }>()
      )?.downloads_count,
    ).toBe(13);
    // A retry after midnight must reuse the original logical acquisition.
    await bindings.DB.prepare("UPDATE download_daily_stats SET day_key = '2001-01-01' WHERE user_id = 'u2'").run();
    expect((await SELF.fetch(url, { method: "POST", headers })).status).toBe(201);
    expect(
      await bindings.DB.prepare(
        "SELECT SUM(count) AS count, COUNT(*) AS days FROM download_daily_stats WHERE user_id = 'u2'",
      ).first(),
    ).toEqual({ count: 1, days: 1 });
    const fresh = await SELF.fetch(url, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    });
    expect(fresh.status).toBe(201);
    expect(
      (
        await bindings.DB.prepare(
          "SELECT SUM(count) AS count FROM download_daily_stats WHERE user_id = 'u2' AND project_version_id = 'r1'",
        ).first<{ count: number }>()
      )?.count,
    ).toBe(2);
    await bindings.DB.prepare(`INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
      SELECT 'r3-worldbook', project_id, 'r3', kind, r2_key, sha256, bytes, mime, created_at
      FROM assets WHERE version_id = 'r1' AND kind = 'worldbook'`).run();
    await bindings.DB.prepare("UPDATE projects SET published_version_id = 'r3' WHERE id = 'p1'").run();
    const replaced = await SELF.fetch(url, { method: "POST", headers });
    expect(replaced.status).toBe(409);
    await expect(replaced.json()).resolves.toMatchObject({ error: { code: "conflict" } });
    expect((await SELF.fetch(fileUrl, { headers })).status).toBe(404);
    const next = await SELF.fetch(url, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    });
    expect(next.status).toBe(201);
    await expect(next.json()).resolves.toMatchObject({ versionId: "r3" });
    expect(
      (
        await bindings.DB.prepare(
          "SELECT project_version_id, SUM(count) AS count FROM download_daily_stats WHERE user_id = 'u2' GROUP BY project_version_id ORDER BY project_version_id",
        ).all()
      ).results,
    ).toEqual([
      { project_version_id: "r1", count: 2 },
      { project_version_id: "r3", count: 1 },
    ]);
    await bindings.DB.prepare("UPDATE projects SET visibility = 'private' WHERE id = 'p1'").run();
    expect((await SELF.fetch(fileUrl, { headers })).status).toBe(404);
    expect((await SELF.fetch(url, { method: "POST", headers })).status).toBe(409);
    expect(
      (
        await SELF.fetch(url, {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        })
      ).status,
    ).toBe(404);
  });

  it("rechecks session expiry after opening the content object", async () => {
    await seed();
    const currentSessionHash = await hashSessionToken("test-token");
    const getObject = bindings.R2.get.bind(bindings.R2);
    const spy = vi.spyOn(bindings.R2, "get").mockImplementationOnce(async (key) => {
      const object = await getObject(key);
      await bindings.DB.prepare("UPDATE sessions SET expires_at = '2001-01-01T00:00:00.000Z' WHERE token_hash = ?")
        .bind(currentSessionHash)
        .run();
      return object;
    });
    try {
      const response = await download(
        new Request("https://workshop.test/api/v1/downloads/p1/r1/worldbook", {
          headers: { authorization: "Bearer test-token" },
        }),
        bindings,
        {} as ExecutionContext,
      );
      expect(response.status).toBe(404);
      expect(
        (await bindings.DB.prepare("SELECT COUNT(*) AS n FROM download_daily_stats").first<{ n: number }>())?.n,
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("separates published public images from private draft delivery", async () => {
    await seed();
    const publicCover = await SELF.fetch(
      new URL("/api/v1/public-assets/covers/p1.webp", "https://workshop.test").toString(),
      undefined,
    );
    expect(publicCover.status).toBe(200);
    expect(new Uint8Array(await publicCover.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const cacheControl = publicCover.headers.get("cache-control") ?? "";
    expect(cacheControl).toMatch(/^public, max-age=\d+, stale-if-error=0$/);
    expect(Number(/max-age=(\d+)/.exec(cacheControl)?.[1])).toBeLessThanOrEqual(60);
    expect(publicCover.headers.get("access-control-allow-origin")).toBe("*");
    expect(publicCover.headers.get("access-control-allow-credentials")).toBeNull();
    expect(publicCover.headers.get("vary")).toBeNull();

    const headers = { authorization: "Bearer test-token" };
    for (const key of ["covers/p1/r3-cover.webp", "covers/p2/r2-cover.webp"]) {
      for (const options of [undefined, { headers }]) {
        const denied = await SELF.fetch(
          new URL(`/api/v1/public-assets/${key}`, "https://workshop.test").toString(),
          options,
        );
        expect(denied.status).toBe(404);
        expect(denied.headers.get("cache-control")).toBe("private, no-store");
      }
      expect(
        (await SELF.fetch(new URL(`/api/v1/assets/${key}`, "https://workshop.test").toString(), undefined)).status,
      ).toBe(404);
      const ownImage = await SELF.fetch(new URL(`/api/v1/assets/${key}`, "https://workshop.test").toString(), {
        headers,
      });
      expect(ownImage.status).toBe(200);
      expect(ownImage.headers.get("cache-control")).toBe("private, no-store");
      await ownImage.arrayBuffer();
    }
    const legacyPublic = await SELF.fetch(
      new URL("/api/v1/assets/covers/p1.webp", "https://workshop.test").toString(),
      undefined,
    );
    expect(legacyPublic.status).toBe(200);
    expect(legacyPublic.headers.get("cache-control")).toBe("private, no-store");
    await legacyPublic.arrayBuffer();

    await bindings.DB.prepare("UPDATE projects SET visibility = 'public', deleted_at = ? WHERE id = 'p1'")
      .bind(now)
      .run();
    expect(
      (await SELF.fetch(new URL("/api/v1/assets/covers/p1.webp", "https://workshop.test").toString(), { headers }))
        .status,
    ).toBe(404);
  });

  it("projects legacy banner URLs publicly and restricts the private asset route", async () => {
    await seed();
    await bindings.R2.put("banners/old.webp", new Uint8Array([1]));
    await bindings.R2.put("banners/new.webp", new Uint8Array([2]));
    const banner = {
      imageUrl: "/api/v1/assets/banners/old.webp",
      positionX: 50,
      positionY: 50,
      zoom: 1,
      mobilePositionX: 50,
      mobilePositionY: 50,
      mobileZoom: 1,
    };
    await bindings.DB.prepare("UPDATE site_settings SET value = ? WHERE key = 'discover_banner'")
      .bind(JSON.stringify(banner))
      .run();
    const site = await SELF.fetch(new URL("/api/v1/site", "https://workshop.test").toString(), undefined);
    await expect(site.json()).resolves.toMatchObject({
      banner: { imageUrl: "/api/v1/public-assets/banners/old.webp" },
    });
    expect(
      (
        await SELF.fetch(
          new URL("/api/v1/public-assets/banners/old.webp", "https://workshop.test").toString(),
          undefined,
        )
      ).status,
    ).toBe(200);
    banner.imageUrl = "/api/v1/public-assets/banners/new.webp";
    await bindings.DB.prepare("UPDATE site_settings SET value = ? WHERE key = 'discover_banner'")
      .bind(JSON.stringify(banner))
      .run();
    expect((await SELF.fetch(new URL(banner.imageUrl, "https://workshop.test").toString(), undefined)).status).toBe(
      200,
    );
    expect(
      (
        await SELF.fetch(new URL("/api/v1/assets/banners/old.webp", "https://workshop.test").toString(), {
          headers: { authorization: "Bearer test-token" },
        })
      ).status,
    ).toBe(404);
  });

  it("serves only completed persisted indexes without reading original assets", async () => {
    await seed();
    await bindings.DB.prepare("UPDATE project_versions SET manifest_hash = 'unindexed-manifest' WHERE id = 'r1'").run();
    expect(
      (await SELF.fetch(new URL("/api/v1/projects/p1/entries", "https://workshop.test").toString(), undefined)).status,
    ).toBe(404);

    const content = "stored 😀";
    const contentHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await bindings.DB.prepare("UPDATE project_versions SET entry_index = ? WHERE id = 'r1'")
      .bind(
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              kind: "worldbook",
              entryKey: "uid:1",
              name: "Stored entry",
              contentHash,
              contentLength: Array.from(content).length,
            },
          ],
        }),
      )
      .run();
    await bindings.R2.delete("projects/p1/versions/r1/worldbook.json");
    const response = await SELF.fetch(
      new URL("/api/v1/projects/p1/entries", "https://workshop.test").toString(),
      undefined,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      versionId: "r1",
      entries: [{ kind: "worldbook", entryKey: "uid:1", name: "Stored entry", contentHash, contentLength: 8 }],
    });

    await bindings.DB.prepare(
      `UPDATE project_versions SET entry_index = '{"schemaVersion":1,"entries":[]}' WHERE id = 'r1'`,
    ).run();
    const empty = await SELF.fetch(
      new URL("/api/v1/projects/p1/entries", "https://workshop.test").toString(),
      undefined,
    );
    expect(await getProjectEntryIndex(bindings.DB, "p1")).toEqual({ versionId: "r1", entries: [] });
    expect([
      { versionId: "r1", entries: [] },
      {
        versionId: "r1",
        entries: [{ kind: "worldbook", entryKey: "uid:1", name: "Stored entry", contentHash, contentLength: 8 }],
      },
    ]).toContainEqual(await empty.json());
  });

  it("returns authorized downloads only after client version and channel checks", async () => {
    await seed();
    expect(
      (
        await SELF.fetch(new URL("/api/v1/projects/p1/acquisitions", "https://workshop.test").toString(), {
          method: "POST",
        })
      ).status,
    ).toBe(401);
    await bindings.DB.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('client_channels', ?, ?)")
      .bind(JSON.stringify({ stable: { revision: "r1", version: "1.0.0" } }), now)
      .run();
    const rejectedHeaders = { authorization: "Bearer test-token", "Idempotency-Key": crypto.randomUUID() };
    const missingChannel = await SELF.fetch(
      new URL("/api/v1/projects/p1/acquisitions", "https://workshop.test").toString(),
      { method: "POST", headers: { ...rejectedHeaders, "x-client-version": "1.0.0" } },
    );
    expect(missingChannel.status).toBe(426);
    const unavailableChannel = await SELF.fetch(
      new URL("/api/v1/projects/p1/acquisitions", "https://workshop.test").toString(),
      {
        method: "POST",
        headers: {
          ...rejectedHeaders,
          "x-client-version": "1.0.0",
          "x-client-channel": "staging",
        },
      },
    );
    expect(unavailableChannel.status).toBe(426);
    const wrongVersion = await SELF.fetch(
      new URL("/api/v1/projects/p1/acquisitions", "https://workshop.test").toString(),
      {
        method: "POST",
        headers: {
          ...rejectedHeaders,
          "x-client-version": "0.9.0",
          "x-client-channel": "stable",
        },
      },
    );
    expect(wrongVersion.status).toBe(426);
    expect(
      await bindings.DB.prepare("SELECT count FROM download_daily_stats WHERE project_id = 'p1'").first(),
    ).toBeNull();
    const acquisitionId = crypto.randomUUID();
    const response = await SELF.fetch(new URL("/api/v1/projects/p1/acquisitions", "https://workshop.test").toString(), {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "x-client-version": "1.0.0",
        "x-client-channel": "stable",
        "Idempotency-Key": acquisitionId,
      },
    });
    expect(response.status).toBe(201);
    const acquisition = (await response.json()) as {
      project: { id: string; version: string };
      release: { files: Array<{ kind: string }> };
      downloads: Array<{ kind: string; url: string }>;
    };
    expect(acquisition.project).toMatchObject({ id: "p1", version: "r1" });
    expect(acquisition.release.files).toMatchObject([{ kind: "worldbook" }]);
    expect(acquisition.downloads.map((file) => file.kind)).toEqual(["worldbook"]);
    const file = await SELF.fetch(new URL(acquisition.downloads[0]!.url, "https://workshop.test").toString(), {
      headers: { authorization: "Bearer test-token" },
    });
    expect(file.status).toBe(200);
    await expect(file.text()).resolves.toBe('{"entries":[]}');
    const replay = () =>
      SELF.fetch("https://workshop.test/api/v1/projects/p1/acquisitions", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "x-client-version": "1.0.0",
          "x-client-channel": "stable",
          "Idempotency-Key": acquisitionId,
        },
      });
    const retry = await replay();
    expect(retry.status).toBe(201);
    await expect(retry.json()).resolves.toEqual(acquisition);
    await bindings.DB.prepare("UPDATE projects SET published_version_id = NULL WHERE id = 'p1'").run();
    expect((await replay()).status).toBe(409);
    expect(
      await bindings.DB.prepare("SELECT SUM(count) AS count FROM download_daily_stats WHERE project_id = 'p1'").first(),
    ).toEqual({ count: 1 });
  });

  it("serves home, recommendations and banner", async () => {
    await seed();
    const [home, recommendations, site, projects] = await Promise.all([
      SELF.fetch(new URL("/api/v1/home", "https://workshop.test").toString(), undefined),
      SELF.fetch(new URL("/api/v1/recommendations", "https://workshop.test").toString(), undefined),
      SELF.fetch(new URL("/api/v1/site", "https://workshop.test").toString(), undefined),
      SELF.fetch(new URL("/api/v1/projects", "https://workshop.test").toString(), undefined),
    ]);
    expect(home.status).toBe(200);
    const homeData = homeResponseSchema.parse(await home.json());
    expect(homeData).toMatchObject({
      site: { ok: true, data: { banner: { positionX: 40 } } },
      discovery: { ok: true },
      projects: { ok: true, data: { items: [{ id: "p1" }] } },
    });
    expect(homeData.projects.ok && homeData.projects.data).toEqual(await projects.json());
    await expect(recommendations.json()).resolves.toMatchObject({
      items: [{ id: "rec1", project: { id: "p1" } }],
    });
    expect(site.status).toBe(200);
    siteSettingsSchema.parse(await site.json());
    expect(await getBanner(bindings.DB)).toMatchObject({ positionX: 40 });
  });

  it("keeps bare public projections, tracking queries, and Hono-only aliases distinct", async () => {
    await seed();
    for (const [path, alias] of [
      ["home", "%68ome"],
      ["site", "%73ite"],
      ["recommendations", "%72ecommendations"],
    ]) {
      const url = `https://workshop.test/api/v1/${path}`;
      const get = await SELF.fetch(url);
      expect(get.status, path).toBe(200);
      expect(get.headers.get("access-control-allow-origin")).toBe("*");
      const body = await get.json();

      const tracked = await SELF.fetch(`${url}/?utm_source=test`);
      expect(tracked.status, path).toBe(200);
      await expect(tracked.json()).resolves.toEqual(body);
      const head = await SELF.fetch(url, { method: "HEAD" });
      expect(head.status, path).toBe(200);
      expect(head.headers.get("access-control-allow-origin")).toBe("*");
      expect(await head.text()).toBe("");

      const invalid = await SELF.fetch(`${url}?_=${Date.now()}`);
      expect(invalid.status, path).toBe(400);
      expect(invalid.headers.get("cache-control")).toBe("private, no-store");
      expect(invalid.headers.get("referrer-policy")).toBeNull();
      await expect(invalid.json()).resolves.toEqual({
        error: { code: "bad_request", message: "Invalid public query" },
      });

      const fallback = await SELF.fetch(`https://workshop.test/api/v1/${alias}`);
      expect(fallback.status, alias).toBe(400);
      expect(fallback.headers.get("cache-control")).toBe("private, no-store");
      expect(fallback.headers.get("referrer-policy")).toBe("same-origin");
      await expect(fallback.json()).resolves.toEqual({
        error: { code: "bad_request", message: "Invalid public query" },
      });
    }
  });
});
