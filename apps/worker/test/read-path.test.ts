import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";
import type { Env } from "../src/env";
import { applySchema } from "./support/schema";

const bindings = env as unknown as Env;
const now = "2026-10-21T00:00:00.000Z";

beforeAll(async () => {
  await applySchema(bindings.DB);
});

beforeEach(async () => {
  await bindings.DB.exec(`
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
  ).bind("u1", "author", "作者", "avatar.png", now, now).run();

  await bindings.DB.prepare(`
    INSERT INTO projects
      (id, author_id, title, description, author_note, project_type, extension_type,
       search_tags, visibility, published_revision_id, published_at, updated_at,
       downloads_count, likes_count, subscriptions_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, ?, ?, 12, 3, 2)
  `).bind(
    "p1", "u1", "命定之诗测试项目", "公开描述", "作者一句话", "系统核心", "规则",
    '["奇幻","测试"]', "r1", now, now,
  ).run();

  await bindings.DB.prepare(`
    INSERT INTO project_revisions
      (id, project_id, revision_no, title, description, author_note, project_type, extension_type,
       tags, worldbook_count, regex_count, schema_version, discord_thread_url, created_by, created_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 12, 4, '4.3', 'https://discord.com/channels/1/2', ?, ?)
  `).bind(
    "r1", "p1", "命定之诗测试项目", "公开描述", "作者一句话", "系统核心", "规则",
    '["奇幻","测试"]', "u1", now,
  ).run();

  await bindings.DB.prepare(`
    INSERT INTO project_revisions (id, project_id, revision_no, title, created_by, created_at)
    VALUES ('r3', 'p1', 2, '草稿', 'u1', ?)
  `).bind(now).run();
  await bindings.DB.prepare("UPDATE projects SET working_revision_id = 'r3' WHERE id = 'p1'").run();

  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('cover1', 'p1', 'r1', 'cover', 'covers/p1.webp', ?, 100, 'image/webp', ?)
  `).bind("0".repeat(64), now).run();
  await bindings.R2.put("covers/p1.webp", new Uint8Array([1, 2, 3]));
  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('cover3', 'p1', 'r3', 'cover', 'covers/p1/r3-cover.webp', ?, 3, 'image/webp', ?)
  `).bind("3".repeat(64), now).run();
  await bindings.R2.put("covers/p1/r3-cover.webp", new Uint8Array([4, 5, 6]));

  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('worldbook1', 'p1', 'r1', 'worldbook', 'projects/p1/revisions/r1/worldbook.json', ?, 20, 'application/json', ?)
  `).bind("1".repeat(64), now).run();
  await bindings.R2.put("projects/p1/revisions/r1/worldbook.json", '{"entries":[]}');

  const tokenHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("test-token")))]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  await bindings.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at, last_seen_at)
    VALUES (?, 'u1', 1, '2099-01-01T00:00:00.000Z', ?, ?)
  `).bind(tokenHash, now, now).run();
  await bindings.DB.prepare(
    "INSERT INTO users (id, username, role, created_at, updated_at) VALUES ('u2', 'other', 'member', ?, ?)",
  ).bind(now, now).run();
  const otherHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("other-token")))]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  await bindings.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at, last_seen_at)
    VALUES (?, 'u2', 1, '2099-01-01T00:00:00.000Z', ?, ?)
  `).bind(otherHash, now, now).run();

  await bindings.DB.prepare(`
    INSERT INTO projects
      (id, author_id, title, visibility, working_revision_id, published_revision_id, published_at, updated_at)
    VALUES ('p2', 'u1', '私有项目', 'private', 'r2', 'r2', ?, ?)
  `).bind(now, now).run();
  await bindings.DB.prepare(`
    INSERT INTO project_revisions (id, project_id, revision_no, title, created_by, created_at)
    VALUES ('r2', 'p2', 1, '私有项目', 'u1', ?)
  `).bind(now).run();
  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('cover2', 'p2', 'r2', 'cover', 'covers/p2/r2-cover.webp', ?, 3, 'image/webp', ?)
  `).bind("2".repeat(64), now).run();
  await bindings.R2.put("covers/p2/r2-cover.webp", new Uint8Array([7, 8, 9]));

  await bindings.DB.prepare(`
    INSERT INTO recommendations (id, curator_id, project_id, comment, reaction, created_at, updated_at)
    VALUES ('rec1', 'u1', 'p1', '推荐语', '🔥', ?, ?)
  `).bind(now, now).run();

  await bindings.DB.prepare(`
    INSERT INTO reference_sets (id, name, description, created_by, created_at, updated_at)
    VALUES ('set1', '官方基准', '基准描述', 'u1', ?, ?)
  `).bind(now, now).run();
  await bindings.DB.prepare(`
    INSERT INTO reference_versions
      (id, reference_set_id, version_label, version_ordinal, grace_until, created_by, created_at)
    VALUES ('v1', 'set1', '4.3.3', 1, ?, 'u1', ?)
  `).bind(now, now).run();
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
  `).bind(JSON.stringify({
    imageUrl: null, positionX: 40, positionY: 50, zoom: 1,
    mobilePositionX: 40, mobilePositionY: 50, mobileZoom: 1,
  }), now).run();
}

describe("public read path", () => {
  it("lists only published public projects", async () => {
    await seed();
    const response = await app.request("/api/v1/projects", undefined, bindings);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: "p1",
      title: "命定之诗测试项目",
      entries: { worldbook: 12, regex: 4 },
      schemaVersion: "4.3",
      counts: { downloads: 12, likes: 3, subscriptions: 2 },
      coverUrl: "/api/v1/assets/covers/p1.webp",
    });
  });

  it("filters by author id and returns an empty page for others", async () => {
    await seed();
    const mine = await app.request("/api/v1/projects?authorId=u1", undefined, bindings);
    expect(mine.status).toBe(200);
    await expect(mine.json()).resolves.toMatchObject({ items: [{ id: "p1", author: { id: "u1" } }] });
    const other = await app.request("/api/v1/projects?authorId=u2", undefined, bindings);
    expect(other.status).toBe(200);
    await expect(other.json()).resolves.toMatchObject({ items: [], nextCursor: null });
  });

  it("filters by exact tag", async () => {
    await seed();
    const tagged = await app.request(`/api/v1/projects?tag=${encodeURIComponent("奇幻")}`, undefined, bindings);
    expect(tagged.status).toBe(200);
    await expect(tagged.json()).resolves.toMatchObject({ items: [{ id: "p1" }] });
    const missing = await app.request(`/api/v1/projects?tag=${encodeURIComponent("不存在")}`, undefined, bindings);
    await expect(missing.json()).resolves.toMatchObject({ items: [] });
  });

  it("supports one- and two-character search across title, tags and author", async () => {
    await seed();
    for (const query of ["命", "命定", "奇幻", "作者", "命定之"]) {
      const response = await app.request(`/api/v1/projects?search=${encodeURIComponent(query)}`, undefined, bindings);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: Array<{ id: string }> };
      expect(body.items.map(item => item.id)).toEqual(["p1"]);
    }
    for (const query of ['"', "'", "-"]) {
      const response = await app.request(`/api/v1/projects?search=${encodeURIComponent(query)}`, undefined, bindings);
      expect(response.status).toBe(200);
    }
    const plan = await bindings.DB.prepare(`
      EXPLAIN QUERY PLAN
      SELECT p.id FROM projects p
      WHERE p.rowid IN (SELECT rowid FROM project_search_short WHERE project_search_short MATCH ?)
    `).bind('"命"').all<{ detail: string }>();
    expect(plan.results.some(row => row.detail.includes("project_search_short"))).toBe(true);
  });

  it("returns project detail and hides private projects", async () => {
    await seed();
    const detail = await app.request("/api/v1/projects/p1", undefined, bindings);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      id: "p1",
      authorNote: "作者一句话",
      discordThreadUrl: "https://discord.com/channels/1/2",
    });

    const hidden = await app.request("/api/v1/projects/p2", undefined, bindings);
    expect(hidden.status).toBe(404);
  });

  it("counts an authenticated download atomically", async () => {
    await seed();
    const anonymous = await app.request("/api/v1/projects/p1/downloads", { method: "POST" }, bindings);
    expect(anonymous.status).toBe(401);

    const headers = { authorization: "Bearer test-token" };
    const response = await app.request("/api/v1/projects/p1/downloads", { method: "POST", headers }, bindings);
    expect(response.status).toBe(201);
    const ticket = await response.json() as { files: Array<{ kind: string; url: string; expiresAt: string }> };
    expect(ticket.files).toHaveLength(1);
    expect(ticket.files[0]).toMatchObject({ kind: "worldbook" });
    expect(ticket.files[0]!.expiresAt).toBeTruthy();

    const otherUser = await app.request(ticket.files[0]!.url, {
      headers: { authorization: "Bearer other-token" },
    }, bindings);
    expect(otherUser.status).toBe(404);
    const download = await app.request(ticket.files[0]!.url, { headers }, bindings);
    expect(download.status).toBe(200);
    await expect(download.text()).resolves.toBe('{"entries":[]}');
    const replay = await app.request(ticket.files[0]!.url, { headers }, bindings);
    expect(replay.status).toBe(404);

    const sessionBound = await app.request("/api/v1/projects/p1/downloads", { method: "POST", headers }, bindings);
    const sessionTicket = await sessionBound.json() as { files: Array<{ url: string }> };
    await bindings.DB.prepare("UPDATE sessions SET session_version = 2 WHERE user_id = 'u1'").run();
    expect((await app.request(sessionTicket.files[0]!.url, { headers }, bindings)).status).toBe(404);
    await bindings.DB.prepare("UPDATE sessions SET session_version = 1 WHERE user_id = 'u1'").run();

    const duplicate = await app.request("/api/v1/projects/p1/downloads", { method: "POST", headers }, bindings);
    expect(duplicate.status).toBe(201);
    const duplicateTicket = await duplicate.json() as { files: Array<{ url: string }> };
    await bindings.DB.prepare("UPDATE download_tokens SET expires_at = ? WHERE token_hash IN (SELECT token_hash FROM download_tokens)")
      .bind("2000-01-01T00:00:00.000Z").run();
    expect((await app.request(duplicateTicket.files[0]!.url, { headers }, bindings)).status).toBe(404);

    const project = await bindings.DB.prepare("SELECT downloads_count FROM projects WHERE id = 'p1'").first<{ downloads_count: number }>();
    expect(project?.downloads_count).toBe(13);
    const metric = await bindings.DB.prepare("SELECT downloads FROM project_metrics_daily WHERE project_id = 'p1'").first<{ downloads: number }>();
    expect(metric?.downloads).toBe(1);
  });

  it("serves only published public covers anonymously", async () => {
    await seed();
    const publicCover = await app.request("/api/v1/assets/covers/p1.webp", undefined, bindings);
    expect(publicCover.status).toBe(200);
    expect(publicCover.headers.get("cache-control")).toContain("public");

    const unpublished = await app.request("/api/v1/assets/covers/p1/r3-cover.webp", undefined, bindings);
    expect(unpublished.status).toBe(404);
    const privateCover = await app.request("/api/v1/assets/covers/p2/r2-cover.webp", undefined, bindings);
    expect(privateCover.status).toBe(404);

    const headers = { authorization: "Bearer test-token" };
    const ownDraft = await app.request("/api/v1/assets/covers/p1/r3-cover.webp", { headers }, bindings);
    expect(ownDraft.status).toBe(200);
    expect(ownDraft.headers.get("cache-control")).toBe("private, no-store");
    const ownPrivate = await app.request("/api/v1/assets/covers/p2/r2-cover.webp", { headers }, bindings);
    expect(ownPrivate.status).toBe(200);
  });

  it("returns an anonymous entry index without content", async () => {
    await seed();
    const response = await app.request("/api/v1/projects/p1/entries", undefined, bindings);
    expect(response.status).toBe(200);
    const body = await response.json() as { revisionId: string; entries: Array<Record<string, unknown>> };
    expect(body.revisionId).toBe("r1");
    expect(Array.isArray(body.entries)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('"content"');
  });

  it("returns an authenticated install payload without exposing it anonymously", async () => {
    await seed();
    expect((await app.request("/api/v1/projects/p1/install", undefined, bindings)).status).toBe(401);
    await bindings.DB.prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('client_channels', ?, ?)",
    ).bind(JSON.stringify({ stable: { revision: "r1", version: "1.0.0" } }), now).run();
    const wrong = await app.request("/api/v1/projects/p1/install", {
      headers: { authorization: "Bearer test-token", "x-client-version": "0.9.0" },
    }, bindings);
    expect(wrong.status).toBe(426);
    const response = await app.request("/api/v1/projects/p1/install", {
      headers: { authorization: "Bearer test-token", "x-client-version": "1.0.0" },
    }, bindings);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      project: { id: "p1", version: "r1" },
      files: { worldbook: '{"entries":[]}' },
    });
  });

  it("requires login for release manifest and files", async () => {
    await seed();
    const anonymous = await app.request("/api/v1/projects/p1/releases/r1/manifest", undefined, bindings);
    expect(anonymous.status).toBe(401);

    const headers = { authorization: "Bearer test-token" };
    const manifest = await app.request("/api/v1/projects/p1/releases/r1/manifest", { headers }, bindings);
    expect(manifest.status).toBe(200);
    await expect(manifest.json()).resolves.toMatchObject({
      revisionId: "r1",
      files: [{ kind: "worldbook", bytes: 20, mime: "application/json" }],
    });

    const file = await app.request("/api/v1/projects/p1/releases/r1/files/worldbook", { headers }, bindings);
    expect(file.status).toBe(200);
    await expect(file.text()).resolves.toBe('{"entries":[]}');

    const forbiddenKind = await app.request("/api/v1/projects/p1/releases/r1/files/cover", { headers }, bindings);
    expect(forbiddenKind.status).toBe(400);
  });

  it("serves home, recommendations, references and banner", async () => {
    await seed();
    const [home, recommendations, references, site] = await Promise.all([
      app.request("/api/v1/home", undefined, bindings),
      app.request("/api/v1/recommendations", undefined, bindings),
      app.request("/api/v1/reference-sets", undefined, bindings),
      app.request("/api/v1/site", undefined, bindings),
    ]);
    expect(home.status).toBe(200);
    await expect(home.json()).resolves.toMatchObject({
      latest: [{ id: "p1" }],
      recommendations: [{ id: "p1" }],
      banner: { positionX: 40 },
    });
    await expect(recommendations.json()).resolves.toMatchObject({
      items: [{ id: "rec1", project: { id: "p1" } }],
    });
    await expect(references.json()).resolves.toMatchObject({
      items: [{ id: "set1", versions: [{ worldbookCount: 1, regexCount: 1 }] }],
    });
    await expect(site.json()).resolves.toMatchObject({ banner: { positionX: 40 } });
  });
});
