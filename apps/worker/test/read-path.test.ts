import { env, SELF } from "cloudflare:test";
import { homeResponseSchema, projectPreviewSchema } from "@workshop/contracts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataEnv } from "../src/data/env";
import { consumeDownloadToken } from "../src/storage/downloads";
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
    DELETE FROM project_gallery;
    DELETE FROM recommendations;
    DELETE FROM reference_sets;
    DELETE FROM site_settings;
    DELETE FROM projects;
    DELETE FROM users;
  `);
});

async function seed() {
  await bindings.DB.prepare(
    "INSERT INTO users (id, username, global_name, avatar, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'member', ?, ?)",
  )
    .bind("u1", "author", "作者", "avatar.png", now, now)
    .run();

  await bindings.DB.prepare(`
    INSERT INTO projects
      (id, author_id, title, description, author_note, project_type, extension_type,
       search_tags, visibility, published_revision_id, published_at, updated_at,
       downloads_count, likes_count, subscriptions_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, ?, ?, 12, 3, 2)
  `)
    .bind(
      "p1",
      "u1",
      "命定之诗测试项目",
      "公开描述",
      "作者一句话",
      "系统核心",
      "规则",
      '["奇幻","测试"]',
      "r1",
      now,
      now,
    )
    .run();

  await bindings.DB.prepare(`
    INSERT INTO project_revisions
      (id, project_id, revision_no, title, description, author_note, project_type, extension_type,
       tags, worldbook_count, regex_count, schema_version, discord_thread_url, created_by, created_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 12, 4, '4.3', 'https://discord.com/channels/1/2', ?, ?)
  `)
    .bind("r1", "p1", "命定之诗测试项目", "公开描述", "作者一句话", "系统核心", "规则", '["奇幻","测试"]', "u1", now)
    .run();

  await bindings.DB.prepare(`
    INSERT INTO project_revisions (id, project_id, revision_no, title, created_by, created_at)
    VALUES ('r3', 'p1', 2, '草稿', 'u1', ?)
  `)
    .bind(now)
    .run();
  await bindings.DB.prepare("UPDATE projects SET working_revision_id = 'r3' WHERE id = 'p1'").run();
  await bindings.DB.prepare(`
    UPDATE projects
    SET published_schema_version = '4.3',
        published_discord_thread_url = 'https://discord.com/channels/1/2'
    WHERE id = 'p1'
  `).run();

  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('cover1', 'p1', 'r1', 'cover', 'covers/p1.webp', ?, 100, 'image/webp', ?)
  `)
    .bind("0".repeat(64), now)
    .run();
  await bindings.R2.put("covers/p1.webp", new Uint8Array([1, 2, 3]));
  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('cover3', 'p1', 'r3', 'cover', 'covers/p1/r3-cover.webp', ?, 3, 'image/webp', ?)
  `)
    .bind("3".repeat(64), now)
    .run();
  await bindings.R2.put("covers/p1/r3-cover.webp", new Uint8Array([4, 5, 6]));

  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('worldbook1', 'p1', 'r1', 'worldbook', 'projects/p1/revisions/r1/worldbook.json', ?, 20, 'application/json', ?)
  `)
    .bind("1".repeat(64), now)
    .run();
  await bindings.R2.put("projects/p1/revisions/r1/worldbook.json", '{"entries":[]}');

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
    "INSERT INTO users (id, username, role, created_at, updated_at) VALUES ('u2', 'other', 'member', ?, ?)",
  )
    .bind(now, now)
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
      (id, author_id, title, visibility, working_revision_id, published_revision_id, published_at, updated_at)
    VALUES ('p2', 'u1', '私有项目', 'private', 'r2', 'r2', ?, ?)
  `)
    .bind(now, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO project_revisions (id, project_id, revision_no, title, created_by, created_at)
    VALUES ('r2', 'p2', 1, '私有项目', 'u1', ?)
  `)
    .bind(now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('cover2', 'p2', 'r2', 'cover', 'covers/p2/r2-cover.webp', ?, 3, 'image/webp', ?)
  `)
    .bind("2".repeat(64), now)
    .run();
  await bindings.R2.put("covers/p2/r2-cover.webp", new Uint8Array([7, 8, 9]));

  await bindings.DB.prepare(`
    INSERT INTO recommendations (id, curator_id, project_id, comment, reaction, created_at, updated_at)
    VALUES ('rec1', 'u1', 'p1', '推荐语', '🔥', ?, ?)
  `)
    .bind(now, now)
    .run();

  await bindings.DB.prepare(`
    INSERT INTO reference_sets (id, name, description, created_by, created_at, updated_at)
    VALUES ('set1', '官方基准', '基准描述', 'u1', ?, ?)
  `)
    .bind(now, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO reference_versions
      (id, reference_set_id, version_label, version_ordinal, grace_until, created_by, created_at)
    VALUES ('v1', 'set1', '4.3.3', 1, ?, 'u1', ?)
  `)
    .bind(now, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO reference_items
      (id, reference_version_id, kind, display_name, exact_hash, normalized_content_hash, name_hash, structure_hash)
    VALUES ('i1', 'v1', 'worldbook', '条目', 'e', 'n', 'name', 's')
  `).run();
  await bindings.DB.prepare(`
    INSERT INTO reference_items
      (id, reference_version_id, kind, display_name, exact_hash, normalized_content_hash, name_hash, structure_hash)
    VALUES ('i2', 'v1', 'regex', '正则', 'e2', 'n2', 'name2', 's2')
  `).run();

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
    await bindings.DB.exec("ALTER TABLE discovery_exposures RENAME TO discovery_exposures_test_hidden");
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
      await bindings.DB.exec("ALTER TABLE discovery_exposures_test_hidden RENAME TO discovery_exposures");
    }
  });

  it("returns a no-store error when all home sections fail", async () => {
    await seed();
    await bindings.DB.exec("ALTER TABLE site_settings RENAME TO site_settings_test_hidden");
    await bindings.DB.exec("ALTER TABLE discovery_exposures RENAME TO discovery_exposures_test_hidden");
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
      await bindings.DB.exec("ALTER TABLE discovery_exposures_test_hidden RENAME TO discovery_exposures");
      await bindings.DB.exec("ALTER TABLE site_settings_test_hidden RENAME TO site_settings");
    }
  });

  it("serves only published public preview text to authenticated readers", async () => {
    await seed();
    await bindings.DB.prepare("UPDATE project_revisions SET entry_index_ready = 1 WHERE id = 'r1'").run();
    await bindings.R2.put(
      "projects/p1/revisions/r1/worldbook.json",
      JSON.stringify({ entries: [{ uid: 7, name: "Greeting", content: "<p>hello</p>" }] }),
    );
    const response = await SELF.fetch(
      new URL("/api/v1/projects/p1/preview/worldbook", "https://workshop.test").toString(),
      { headers: { authorization: "Bearer test-token" } },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      revisionId: "r1",
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
    await bindings.DB.prepare("UPDATE project_revisions SET entry_index_ready = 1 WHERE id IN ('r1', 'r3')").run();
    await bindings.R2.put("projects/p1/revisions/r1/worldbook.json", '{"entries":[{"uid":1,"content":"first"}]}');
    const url = "https://workshop.test/api/v1/projects/p1/preview/worldbook";
    const request = (token: string) => SELF.fetch(url, { headers: { authorization: `Bearer ${token}` } });
    for (const token of ["test-token", "other-token"]) {
      const response = await request(token);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      await expect(response.json()).resolves.toMatchObject({ revisionId: "r1", entries: [{ content: "first" }] });
    }
    await bindings.DB.prepare("DELETE FROM sessions WHERE user_id = 'u1'").run();
    expect((await request("test-token")).status).toBe(401);
    await bindings.DB.prepare("UPDATE projects SET visibility = 'private' WHERE id = 'p1'").run();
    expect((await request("other-token")).status).toBe(404);
    await bindings.DB.prepare(
      "UPDATE projects SET visibility = 'public', published_revision_id = 'r3' WHERE id = 'p1'",
    ).run();
    await bindings.DB.prepare(`INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
      VALUES ('worldbook3', 'p1', 'r3', 'worldbook', 'projects/p1/revisions/r3/worldbook.json', ?, 20, 'application/json', ?)`)
      .bind("2".repeat(64), now)
      .run();
    await bindings.R2.put("projects/p1/revisions/r3/worldbook.json", '{"entries":[{"uid":2,"content":"second"}]}');
    const changed = await request("other-token");
    expect(changed.status).toBe(200);
    await expect(changed.json()).resolves.toMatchObject({ revisionId: "r3", entries: [{ content: "second" }] });
    await bindings.R2.put("projects/p1/revisions/r3/worldbook.json", "invalid JSON");
    expect((await request("other-token")).status).toBe(404);
    await bindings.R2.delete("projects/p1/revisions/r3/worldbook.json");
    expect((await request("other-token")).status).toBe(404);
  });

  it("returns only allowlisted behavior fields without inventing source defaults", async () => {
    await seed();
    await bindings.DB.prepare("UPDATE project_revisions SET entry_index_ready = 1 WHERE id = 'r1'").run();
    await bindings.R2.put(
      "projects/p1/revisions/r1/worldbook.json",
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
        revisionId: "old",
        kind: "worldbook",
        entries: [{ key: "old", name: "Old", content: "text" }],
      }).success,
    ).toBe(true);
  });

  it("keeps regex patterns and replacement code as display text", async () => {
    await seed();
    await bindings.DB.prepare(
      "UPDATE project_revisions SET entry_index_ready = 1, regex_count = 1 WHERE id = 'r1'",
    ).run();
    await bindings.DB.prepare(`INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
      VALUES ('regex1', 'p1', 'r1', 'regex', 'projects/p1/revisions/r1/regex.json', ?, 20, 'application/json', ?)`)
      .bind("4".repeat(64), now)
      .run();
    const source = "<script>throw new Error('must not run')</script>😀";
    await bindings.R2.put(
      "projects/p1/revisions/r1/regex.json",
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
      "UPDATE project_revisions SET entry_index_ready = 1, regex_count = 0 WHERE id = 'r1'",
    ).run();
    const empty = await SELF.fetch(new URL("/api/v1/projects/p1/preview/regex", "https://workshop.test").toString(), {
      headers: { authorization: "Bearer test-token" },
    });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ revisionId: "r1", kind: "regex", entries: [] });
    await bindings.DB.prepare("UPDATE project_revisions SET regex_count = 1 WHERE id = 'r1'").run();
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
    const page = await listPublishedProjects(bindings.DB, { limit: 24, sort: "updated" }, (value) => {
      meta.rows_read = value.rows_read;
      meta.rows_written = value.rows_written;
    });
    expect(page.items.length).toBeGreaterThan(0);
    expect(meta.rows_read).toBeLessThan(200);
    expect(meta.rows_written).toBe(0);
  });

  it("paginates with a stable keyset cursor", async () => {
    await seed();
    for (const [projectId, revisionId, updatedAt] of [
      ["p3", "r4", "2026-10-20T00:00:00.000Z"],
      ["p4", "r5", "2026-10-19T00:00:00.000Z"],
    ] as const) {
      await bindings.DB.prepare(`
        INSERT INTO projects
          (id, author_id, title, visibility, published_revision_id, published_at, updated_at)
        VALUES (?, 'u1', ?, 'public', ?, ?, ?)
      `)
        .bind(projectId, projectId, revisionId, updatedAt, updatedAt)
        .run();
      await bindings.DB.prepare(`
        INSERT INTO project_revisions (id, project_id, revision_no, title, created_by, created_at)
        VALUES (?, ?, 1, ?, 'u1', ?)
      `)
        .bind(revisionId, projectId, projectId, updatedAt)
        .run();
    }
    const first = await listPublishedProjects(bindings.DB, { limit: 2, sort: "updated" });
    expect(first.items.map((item) => item.id)).toEqual(["p1", "p3"]);
    expect(first.nextCursor).toBeTruthy();
    const second = await listPublishedProjects(bindings.DB, {
      limit: 2,
      sort: "updated",
      cursor: first.nextCursor!,
    });
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
      authorNote: "作者一句话",
      discordThreadUrl: "https://discord.com/channels/1/2",
    });

    const hidden = await SELF.fetch(new URL("/api/v1/projects/p2", "https://workshop.test").toString(), undefined);
    expect(hidden.status).toBe(404);
  });

  it("counts an authenticated download atomically", async () => {
    await seed();
    const anonymous = await SELF.fetch(new URL("/api/v1/projects/p1/downloads", "https://workshop.test").toString(), {
      method: "POST",
    });
    expect(anonymous.status).toBe(401);

    const headers = { authorization: "Bearer other-token" };
    const response = await SELF.fetch(new URL("/api/v1/projects/p1/downloads", "https://workshop.test").toString(), {
      method: "POST",
      headers,
    });
    expect(response.status).toBe(201);
    const ticket = (await response.json()) as { files: Array<{ kind: string; url: string; expiresAt: string }> };
    expect(ticket.files).toHaveLength(1);
    expect(ticket.files[0]).toMatchObject({ kind: "worldbook" });
    expect(ticket.files[0]!.expiresAt).toBeTruthy();
    const afterIssue = await bindings.DB.prepare("SELECT downloads_count FROM projects WHERE id = 'p1'").first<{
      downloads_count: number;
    }>();
    expect(afterIssue?.downloads_count).toBe(12);

    const otherUser = await SELF.fetch(new URL(ticket.files[0]!.url, "https://workshop.test").toString(), {
      headers: { authorization: "Bearer test-token" },
    });
    expect(otherUser.status).toBe(404);
    const download = await SELF.fetch(new URL(ticket.files[0]!.url, "https://workshop.test").toString(), { headers });
    expect(download.status).toBe(200);
    await expect(download.text()).resolves.toBe('{"entries":[]}');
    const replay = await SELF.fetch(new URL(ticket.files[0]!.url, "https://workshop.test").toString(), { headers });
    expect(replay.status).toBe(404);

    const concurrentIssue = await SELF.fetch(
      new URL("/api/v1/projects/p1/downloads", "https://workshop.test").toString(),
      { method: "POST", headers },
    );
    const concurrentTicket = (await concurrentIssue.json()) as { files: Array<{ url: string }> };
    const concurrent = await Promise.all([
      SELF.fetch(new URL(concurrentTicket.files[0]!.url, "https://workshop.test").toString(), { headers }),
      SELF.fetch(new URL(concurrentTicket.files[0]!.url, "https://workshop.test").toString(), { headers }),
    ]);
    expect(concurrent.filter((response) => response.status === 200)).toHaveLength(1);
    expect(concurrent.filter((response) => response.status === 404)).toHaveLength(1);
    const authorHeaders = { authorization: "Bearer test-token" };
    const authorIssue = await SELF.fetch(new URL("/api/v1/projects/p1/downloads", "https://workshop.test").toString(), {
      method: "POST",
      headers: authorHeaders,
    });
    const authorTicket = (await authorIssue.json()) as { files: Array<{ url: string }> };
    const authorDownload = await SELF.fetch(new URL(authorTicket.files[0]!.url, "https://workshop.test").toString(), {
      headers: authorHeaders,
    });
    expect(authorDownload.status).toBe(200);
    await authorDownload.arrayBuffer();

    const sessionBound = await SELF.fetch(
      new URL("/api/v1/projects/p1/downloads", "https://workshop.test").toString(),
      { method: "POST", headers },
    );
    const sessionTicket = (await sessionBound.json()) as { files: Array<{ url: string }> };
    await bindings.DB.prepare("UPDATE sessions SET session_version = 2 WHERE user_id = 'u2'").run();
    expect(
      (await SELF.fetch(new URL(sessionTicket.files[0]!.url, "https://workshop.test").toString(), { headers })).status,
    ).toBe(404);
    await bindings.DB.prepare("UPDATE sessions SET session_version = 1 WHERE user_id = 'u2'").run();

    const duplicate = await SELF.fetch(new URL("/api/v1/projects/p1/downloads", "https://workshop.test").toString(), {
      method: "POST",
      headers,
    });
    expect(duplicate.status).toBe(201);
    const duplicateTicket = (await duplicate.json()) as { files: Array<{ url: string }> };
    await bindings.DB.prepare(
      "UPDATE download_tokens SET expires_at = ? WHERE token_hash IN (SELECT token_hash FROM download_tokens)",
    )
      .bind("2000-01-01T00:00:00.000Z")
      .run();
    expect(
      (await SELF.fetch(new URL(duplicateTicket.files[0]!.url, "https://workshop.test").toString(), { headers }))
        .status,
    ).toBe(404);

    const project = await bindings.DB.prepare("SELECT downloads_count FROM projects WHERE id = 'p1'").first<{
      downloads_count: number;
    }>();
    expect(project?.downloads_count).toBe(13);
    const metric = await bindings.DB.prepare(
      "SELECT downloads FROM project_metrics_daily WHERE project_id = 'p1'",
    ).first<{ downloads: number }>();
    expect(metric?.downloads).toBe(1);
  });

  it.each(["ticket", "session"] as const)("rechecks %s expiry after opening R2 without counting", async (boundary) => {
    await seed();
    const issued = await SELF.fetch(new URL("/api/v1/projects/p1/downloads", "https://workshop.test").toString(), {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
    });
    const ticket = (await issued.json()) as { files: Array<{ url: string }> };
    const token = ticket.files[0]!.url.split("/").pop()!;
    const currentSessionHash = await hashSessionToken("test-token");
    const otherSessionHash = await hashSessionToken("other-session-token");
    await bindings.DB.prepare(`
      INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at, last_seen_at)
      VALUES (?, 'u1', 1, '2099-01-01T00:00:00.000Z', ?, ?)
    `)
      .bind(otherSessionHash, now, now)
      .run();
    const getObject = bindings.R2.get.bind(bindings.R2);
    const spy = vi.spyOn(bindings.R2, "get").mockImplementationOnce(async (key) => {
      const object = await getObject(key);
      // The pre-read occurred before the deadline, but consumption is now
      // after it. Only Date is faked; D1's transaction clock remains current.
      const sql =
        boundary === "ticket"
          ? "UPDATE download_tokens SET expires_at = '2001-01-01T00:00:00.000Z'"
          : `UPDATE sessions SET expires_at = '2001-01-01T00:00:00.000Z' WHERE token_hash = '${currentSessionHash}'`;
      await bindings.DB.prepare(sql).run();
      return object;
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2000-01-01T00:00:00.000Z"));
    try {
      const result = await consumeDownloadToken(bindings.DB, bindings.R2, token, {
        userId: "u1",
        role: "member",
        sessionVersion: 1,
        tokenHash: currentSessionHash,
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      expect(result).toBe("not_found");
      const persisted = await bindings.DB.prepare(`
        SELECT (SELECT consumed_at FROM download_tokens LIMIT 1) AS consumed_at,
          (SELECT downloads_count FROM projects WHERE id = 'p1') AS downloads,
          (SELECT COUNT(*) FROM download_events WHERE project_id = 'p1') AS events
      `).first<{ consumed_at: string | null; downloads: number; events: number }>();
      expect(persisted).toEqual({ consumed_at: null, downloads: 12, events: 0 });
    } finally {
      vi.useRealTimers();
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
    expect(publicCover.headers.get("cache-control")).toBe("public, max-age=300, stale-if-error=0");
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
    }
    const legacyPublic = await SELF.fetch(
      new URL("/api/v1/assets/covers/p1.webp", "https://workshop.test").toString(),
      undefined,
    );
    expect(legacyPublic.status).toBe(200);
    expect(legacyPublic.headers.get("cache-control")).toBe("private, no-store");

    await bindings.DB.prepare("UPDATE projects SET visibility = 'private' WHERE id = 'p1'").run();
    expect(
      (
        await SELF.fetch(new URL("/api/v1/public-assets/covers/p1.webp", "https://workshop.test").toString(), {
          headers,
        })
      ).status,
    ).toBe(404);
    await bindings.DB.prepare("UPDATE projects SET visibility = 'public', deleted_at = ? WHERE id = 'p1'")
      .bind(now)
      .run();
    expect(
      (await SELF.fetch(new URL("/api/v1/public-assets/covers/p1.webp", "https://workshop.test").toString(), undefined))
        .status,
    ).toBe(404);
    expect(
      (await SELF.fetch(new URL("/api/v1/assets/covers/p1.webp", "https://workshop.test").toString(), { headers }))
        .status,
    ).toBe(404);
  });

  it("projects legacy banner URLs publicly without retaining replaced banner access", async () => {
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
        await SELF.fetch(
          new URL("/api/v1/public-assets/banners/old.webp", "https://workshop.test").toString(),
          undefined,
        )
      ).status,
    ).toBe(404);
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
    await bindings.DB.prepare(
      "UPDATE project_revisions SET manifest_hash = 'unindexed-manifest' WHERE id = 'r1'",
    ).run();
    expect(
      (await SELF.fetch(new URL("/api/v1/projects/p1/entries", "https://workshop.test").toString(), undefined)).status,
    ).toBe(404);

    const content = "stored 😀";
    const contentHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await bindings.DB.batch([
      bindings.DB.prepare(`
        INSERT INTO revision_entry_index (revision_id, kind, entry_key, name, content_hash, content_length)
        VALUES ('r1', 'worldbook', 'uid:1', 'Stored entry', ?, ?)
      `).bind(contentHash, Array.from(content).length),
      bindings.DB.prepare("UPDATE project_revisions SET entry_index_ready = 1 WHERE id = 'r1'"),
    ]);
    await bindings.R2.delete("projects/p1/revisions/r1/worldbook.json");
    const response = await SELF.fetch(
      new URL("/api/v1/projects/p1/entries", "https://workshop.test").toString(),
      undefined,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      revisionId: "r1",
      entries: [{ kind: "worldbook", entryKey: "uid:1", name: "Stored entry", contentHash, contentLength: 8 }],
    });

    await bindings.DB.prepare("DELETE FROM revision_entry_index WHERE revision_id = 'r1'").run();
    const empty = await SELF.fetch(
      new URL("/api/v1/projects/p1/entries", "https://workshop.test").toString(),
      undefined,
    );
    await expect(empty.json()).resolves.toEqual({ revisionId: "r1", entries: [] });
  });

  it("returns acquisition tickets only after client version and channel checks", async () => {
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
    const missingChannel = await SELF.fetch(
      new URL("/api/v1/projects/p1/acquisitions", "https://workshop.test").toString(),
      { method: "POST", headers: { authorization: "Bearer test-token", "x-client-version": "1.0.0" } },
    );
    expect(missingChannel.status).toBe(426);
    const wrongChannel = await SELF.fetch(
      new URL("/api/v1/projects/p1/acquisitions", "https://workshop.test").toString(),
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "x-client-version": "1.0.0",
          "x-client-channel": "staging",
        },
      },
    );
    expect(wrongChannel.status).toBe(426);
    const wrongVersion = await SELF.fetch(
      new URL("/api/v1/projects/p1/acquisitions", "https://workshop.test").toString(),
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "x-client-version": "0.9.0",
          "x-client-channel": "stable",
        },
      },
    );
    expect(wrongVersion.status).toBe(426);
    const response = await SELF.fetch(new URL("/api/v1/projects/p1/acquisitions", "https://workshop.test").toString(), {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "x-client-version": "1.0.0",
        "x-client-channel": "stable",
      },
    });
    expect(response.status).toBe(201);
    const acquisition = (await response.json()) as {
      project: { id: string; version: string };
      release: { files: Array<{ kind: string }> };
      tickets: Array<{ kind: string; url: string }>;
    };
    expect(acquisition.project).toMatchObject({ id: "p1", version: "r1" });
    expect(acquisition.release.files).toMatchObject([{ kind: "worldbook" }]);
    expect(acquisition.tickets.map((ticket) => ticket.kind)).toEqual(["worldbook"]);
    const file = await SELF.fetch(new URL(acquisition.tickets[0]!.url, "https://workshop.test").toString(), {
      headers: { authorization: "Bearer test-token" },
    });
    expect(file.status).toBe(200);
    await expect(file.text()).resolves.toBe('{"entries":[]}');
  });

  it("serves home, recommendations, references and banner", async () => {
    await seed();
    const [home, recommendations, references, site, projects] = await Promise.all([
      SELF.fetch(new URL("/api/v1/home", "https://workshop.test").toString(), undefined),
      SELF.fetch(new URL("/api/v1/recommendations", "https://workshop.test").toString(), undefined),
      SELF.fetch(new URL("/api/v1/reference-sets", "https://workshop.test").toString(), undefined),
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
    await expect(references.json()).resolves.toMatchObject({
      items: [{ id: "set1", versions: [{ worldbookCount: 1, regexCount: 1 }] }],
    });
    await expect(site.json()).resolves.toMatchObject({ banner: { positionX: 40 } });
  });
});
