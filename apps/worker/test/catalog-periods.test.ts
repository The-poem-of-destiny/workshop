import { env, SELF } from "cloudflare:test";
import { projectListQuerySchema, projectListResponseSchema } from "@workshop/contracts";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataEnv } from "../src/data/env";
import { canonicalPublicRequest } from "../src/http/public-cache";
import { consumeDownloadToken, issueDownloadTickets } from "../src/storage/downloads";
import { setLike, unsetLike } from "../src/storage/interactions";
import { isValidProjectListCursor, listPublishedProjects } from "../src/storage/projects";
import { hashSessionToken } from "../src/storage/session-hash";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const asOf = "2026-10-26T12:00:00.000Z";

beforeAll(async () => applySchema(bindings.DB));
beforeEach(async () => {
  await bindings.DB.exec("DELETE FROM projects; DELETE FROM users;");
  await bindings.DB.prepare("INSERT INTO users (id, username) VALUES ('u', 'author')").run();
  await bindings.R2.delete("catalog/wb");
});
afterEach(() => vi.useRealTimers());

async function project(id: string, type = "角色", tags = '["奇幻"]') {
  await bindings.DB.prepare(`INSERT INTO projects
    (id, author_id, title, project_type, search_tags, visibility, published_revision_id, published_at, updated_at)
    VALUES (?, 'u', ?, ?, ?, 'public', ?, ?, ?)`)
    .bind(id, `奇幻${id}`, type, tags, `r-${id}`, asOf, asOf)
    .run();
  await bindings.DB.prepare(`INSERT INTO project_revisions
    (id, project_id, revision_no, title, created_by) VALUES (?, ?, 1, ?, 'u')`)
    .bind(`r-${id}`, id, id)
    .run();
}

async function event(id: string, delta: number, time: string) {
  await bindings.DB.prepare(`INSERT INTO project_like_events
    (project_id, delta, occurred_at, source) VALUES (?, ?, ?, 'interaction')`)
    .bind(id, delta, time)
    .run();
}

describe("catalog net windows on real D1", () => {
  it("preserves period selection through the real Worker gateway and canonical public keys", async () => {
    await project("recent");
    await project("older");
    const now = Date.now();
    await event("recent", 1, new Date(now - 86_400_000).toISOString());
    await event("older", 1, new Date(now - 14 * 86_400_000).toISOString());
    await event("older", 1, new Date(now - 13 * 86_400_000).toISOString());
    await bindings.DB.prepare("UPDATE projects SET likes_count = CASE id WHEN 'recent' THEN 1 ELSE 2 END").run();
    const canonicalUrls = new Map<string, string>();
    for (const period of ["all", "7d", "30d"] as const) {
      const url = `https://workshop.example/api/v1/projects?sort=likes&period=${period}`;
      const canonical = canonicalPublicRequest(new Request(url));
      expect(canonical.kind).toBe("public");
      if (canonical.kind !== "public") throw new Error("Expected public catalog request");
      canonicalUrls.set(period, canonical.request.url);
      const response = await SELF.fetch(url);
      expect(response.status).toBe(200);
      const body = projectListResponseSchema.parse(await response.json());
      expect(body.total).toBe(2);
      expect(body.items.map((item) => item.id)).toEqual(period === "7d" ? ["recent", "older"] : ["older", "recent"]);
    }
    expect(new Set(canonicalUrls.values()).size).toBe(3);
    expect(new URL(canonicalUrls.get("7d")!).searchParams.get("period")).toBe("7d");
    expect(new URL(canonicalUrls.get("30d")!).searchParams.get("period")).toBe("30d");
    const omitted = canonicalPublicRequest(new Request("https://workshop.example/api/v1/projects?sort=likes"));
    expect(omitted.kind).toBe("public");
    if (omitted.kind !== "public") throw new Error("Expected public default catalog request");
    expect(omitted.request.url).toBe(canonicalUrls.get("all"));
  });

  it("rejects anonymous complete previews and returns authenticated content privately", async () => {
    await project("preview");
    await bindings.DB.prepare("UPDATE project_revisions SET entry_index_ready = 1 WHERE id = 'r-preview'").run();
    const anonymous = await SELF.fetch(
      new URL("/api/v1/projects/preview/preview/worldbook", "https://workshop.test").toString(),
      {},
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toContain("no-store");
    const token = "catalog-preview-session";
    const tokenHash = await hashSessionToken(token, bindings.SESSION_HASH_SECRET);
    await bindings.DB.prepare(`INSERT INTO sessions (token_hash, user_id, session_version, expires_at)
      VALUES (?, 'u', 1, '2099-01-01T00:00:00.000Z')`)
      .bind(tokenHash)
      .run();
    const response = await SELF.fetch(
      new URL("/api/v1/projects/preview/preview/worldbook", "https://workshop.test").toString(),
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ revisionId: "r-preview", kind: "worldbook", entries: [] });
  });

  it("emits only actual like transitions and counts cancellation of an old like negatively", async () => {
    await project("negative");
    await project("zero");
    await setLike(bindings.DB, "u", "negative");
    await setLike(bindings.DB, "u", "negative");
    const inserted = await bindings.DB.prepare("SELECT COUNT(*) AS n FROM project_like_events").first<{ n: number }>();
    expect(inserted?.n).toBe(1);
    await bindings.DB.prepare("UPDATE project_like_events SET occurred_at = '2020-01-01T00:00:00.000Z'").run();
    await unsetLike(bindings.DB, "u", "negative");
    await unsetLike(bindings.DB, "u", "negative");
    const events = await bindings.DB.prepare("SELECT delta FROM project_like_events ORDER BY id").all<{
      delta: number;
    }>();
    expect(events.results.map((row) => row.delta)).toEqual([1, -1]);
    const page = await listPublishedProjects(bindings.DB, { limit: 10, sort: "likes", period: "7d" });
    expect(page.items.map((item) => item.id)).toEqual(["zero", "negative"]);
    expect(page.items[1]?.counts.likes).toBe(0);
  });

  for (const days of [7, 30, 90] as const) {
    it(`uses exact inclusive UTC ${days}-day bounds, not project age`, async () => {
      await project("inside");
      await project("outside");
      await project("negative");
      const start = Date.parse(asOf) - days * 86_400_000;
      await event("inside", 1, new Date(start).toISOString());
      await event("outside", 1, new Date(start - 1).toISOString());
      await event("outside", 1, new Date(Date.parse(asOf) + 1).toISOString());
      await event("negative", -1, asOf);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(asOf));
      const page = await listPublishedProjects(bindings.DB, { limit: 10, sort: "likes", period: `${days}d` });
      expect(page.items.map((item) => item.id)).toEqual(["inside", "outside", "negative"]);
      expect(page.total).toBe(3);
    });
  }

  it("filters the complete result, reports exact totals on every page and binds cursors to query scope", async () => {
    for (const id of ["a", "b", "c", "d", "e"]) await project(id);
    await project("other-type", "扩展");
    await project("other-tag", "角色", '["科幻"]');
    await event("a", 1, asOf);
    await event("c", -1, asOf);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(asOf));
    const query = projectListQuerySchema.parse({
      limit: 2,
      sort: "likes",
      period: "30d",
      projectType: "角色",
      tag: "奇幻",
      search: "奇幻",
      authorId: "u",
    });
    const first = await listPublishedProjects(bindings.DB, query);
    expect(first.total).toBe(5);
    expect(first.items.map((item) => item.id)).toEqual(["a", "e"]);
    expect(first.nextCursor).not.toBeNull();
    for (const change of [
      { sort: "downloads" as const },
      { period: "7d" as const },
      { tag: "科幻" },
      { search: "别的" },
      { authorId: "other" },
    ]) {
      expect(isValidProjectListCursor({ ...query, ...change, cursor: first.nextCursor! })).toBe(false);
    }
    const second = await listPublishedProjects(bindings.DB, { ...query, cursor: first.nextCursor! });
    const third = await listPublishedProjects(bindings.DB, { ...query, cursor: second.nextCursor! });
    expect([second.total, third.total]).toEqual([5, 5]);
    expect([...first.items, ...second.items, ...third.items].map((item) => item.id)).toEqual(["a", "e", "d", "b", "c"]);
    expect(third.nextCursor).toBeNull();
    expect((await listPublishedProjects(bindings.DB, { ...query, tag: "不存在" })).total).toBe(0);
    const invalid = await SELF.fetch(
      new URL(
        `/api/v1/projects?sort=likes&period=7d&cursor=${encodeURIComponent(first.nextCursor!)}`,
        "https://workshop.test",
      ).toString(),
      {},
    );
    expect(invalid.status).toBe(400);
  });

  it("keeps all-time counts and publication/update ordering distinct", async () => {
    await project("a");
    await project("b");
    await bindings.DB.prepare(`UPDATE projects SET downloads_count = 5, likes_count = 4,
      published_at = '2020-01-01T00:00:00.000Z', updated_at = '2099-01-01T00:00:00.000Z' WHERE id = 'a'`).run();
    await bindings.DB.prepare(`UPDATE projects SET published_updated_at = CASE id
      WHEN 'a' THEN '2026-10-26T11:00:00.000Z'
      ELSE '2026-10-26T10:00:00.000Z' END WHERE id IN ('a', 'b')`).run();
    // A draft edit newer than either approval must not move b ahead of a.
    await bindings.DB.prepare("UPDATE projects SET updated_at = '2099-12-31T00:00:00.000Z' WHERE id = 'b'").run();
    for (const sort of ["likes", "downloads", "updated"] as const) {
      const page = await listPublishedProjects(bindings.DB, { limit: 10, sort, period: "all" });
      expect(page.items.map((item) => item.id)).toEqual(["a", "b"]);
    }
    const published = await listPublishedProjects(bindings.DB, { limit: 10, sort: "published" });
    expect(published.items.map((item) => item.id)).toEqual(["b", "a"]);
    const updated = await listPublishedProjects(bindings.DB, { limit: 10, sort: "updated" });
    expect(updated.items.map((item) => item.updatedAt)).toEqual([
      "2026-10-26T11:00:00.000Z",
      "2026-10-26T10:00:00.000Z",
    ]);
  });

  it("applies timestamp bounds to download events and keeps read accounting bounded", async () => {
    await project("inside");
    await project("outside");
    await project("future");
    const boundary = new Date(Date.parse(asOf) - 7 * 86_400_000).toISOString();
    for (const [id, time] of [
      ["inside", boundary],
      ["outside", new Date(Date.parse(boundary) - 1).toISOString()],
      ["future", new Date(Date.parse(asOf) + 1).toISOString()],
    ]) {
      await bindings.DB.prepare(`INSERT INTO download_events (user_id, project_id, day_key, created_at)
        VALUES ('u', ?, ?, ?)`)
        .bind(id, time!.slice(0, 10), time)
        .run();
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(asOf));
    let reads = Infinity;
    let writes = Infinity;
    const page = await listPublishedProjects(bindings.DB, { limit: 2, sort: "downloads", period: "7d" }, (meta) => {
      reads = meta.rows_read;
      writes = meta.rows_written;
    });
    expect(page.items.map((item) => item.id)).toEqual(["inside", "outside"]);
    expect(page.total).toBe(3);
    expect(reads).toBeLessThan(200);
    expect(writes).toBe(0);
  });

  it("counts only successful consumption, once per user/project/UTC day", async () => {
    await project("download");
    await project("zero");
    const hash = "session-hash";
    await bindings.DB.prepare(`INSERT INTO sessions (token_hash, user_id, session_version, expires_at)
      VALUES (?, 'u', 1, '2099-01-01T00:00:00.000Z')`)
      .bind(hash)
      .run();
    const session = {
      userId: "u",
      sessionVersion: 1,
      tokenHash: hash,
      role: "member" as const,
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    await bindings.DB.prepare(`INSERT INTO assets
      (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime)
      VALUES ('wb', 'download', 'r-download', 'worldbook', 'catalog/wb', ?, 2, 'application/json')`)
      .bind("0".repeat(64))
      .run();
    const tickets = await issueDownloadTickets(
      bindings.DB,
      "download",
      "r-download",
      "u",
      1,
      [{ kind: "worldbook" }],
      60000,
    );
    expect(await consumeDownloadToken(bindings.DB, bindings.R2, tickets[0]!.token, session)).toBe("not_found");
    expect((await bindings.DB.prepare("SELECT COUNT(*) AS n FROM download_events").first<{ n: number }>())?.n).toBe(0);
    await bindings.R2.put("catalog/wb", "{}");
    expect(await consumeDownloadToken(bindings.DB, bindings.R2, tickets[0]!.token, session)).toHaveProperty("object");
    expect(await consumeDownloadToken(bindings.DB, bindings.R2, tickets[0]!.token, session)).toBe("not_found");
    const again = await issueDownloadTickets(
      bindings.DB,
      "download",
      "r-download",
      "u",
      1,
      [{ kind: "worldbook" }],
      60000,
    );
    expect(await consumeDownloadToken(bindings.DB, bindings.R2, again[0]!.token, session)).toHaveProperty("object");
    const counted = await bindings.DB.prepare("SELECT downloads_count FROM projects WHERE id = 'download'").first<{
      downloads_count: number;
    }>();
    expect(counted?.downloads_count).toBe(1);
    for (const period of ["all", "7d", "30d", "90d"] as const) {
      const page = await listPublishedProjects(bindings.DB, { limit: 10, sort: "downloads", period });
      expect(page.items.map((item) => item.id)).toEqual(["download", "zero"]);
    }
  });
});
