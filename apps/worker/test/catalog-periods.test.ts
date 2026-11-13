import { env, SELF } from "cloudflare:test";
import { type ProjectType, projectListQuerySchema, projectListResponseSchema } from "@workshop/contracts";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataEnv } from "../src/data/env";
import { setLike, unsetLike } from "../src/storage/interactions";
import { isValidProjectListCursor, listPublishedProjects } from "../src/storage/projects";
import { hashSessionToken } from "../src/storage/session-hash";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const asOf = "2026-10-26T12:00:00.000Z";

beforeAll(async () => applySchema(bindings.DB));
beforeEach(async () => {
  await bindings.DB.exec(
    "DELETE FROM download_daily_stats; UPDATE projects SET working_version_id=NULL, published_version_id=NULL, published_cover_asset_id=NULL; DELETE FROM assets; DELETE FROM project_versions; DELETE FROM projects; DELETE FROM users;",
  );
  await bindings.DB.prepare("INSERT INTO users (id, username) VALUES ('u', 'author')").run();
  await bindings.R2.delete("catalog/wb");
});
afterEach(() => vi.useRealTimers());

async function project(id: string, type: ProjectType = "角色", tags = '["奇幻"]', includedTypes: readonly ProjectType[] = []) {
  await bindings.DB.prepare(`INSERT INTO projects
    (id, author_id, visibility, published_at, updated_at)
    VALUES (?, 'u', 'public', ?, ?)`)
    .bind(id, asOf, asOf)
    .run();
  await bindings.DB.prepare(`INSERT INTO project_versions
    (id, project_id, version_no, title, project_type, tags, included_types, created_by) VALUES (?, ?, 1, ?, ?, ?, ?, 'u')`)
    .bind(`r-${id}`, id, `奇幻${id}`, type, tags, JSON.stringify(includedTypes))
    .run();
  await bindings.DB.prepare("UPDATE projects SET published_version_id = ? WHERE id = ?").bind(`r-${id}`, id).run();
}

async function event(id: string, delta: number, time: string) {
  await bindings.DB.prepare(`INSERT INTO project_metrics_daily(project_id,day_key,likes_delta) VALUES(?,?,?)
    ON CONFLICT(project_id,day_key) DO UPDATE SET likes_delta = likes_delta + excluded.likes_delta`)
    .bind(id, time.slice(0, 10), delta)
    .run();
}

describe("catalog net windows on real D1", () => {
  it("preserves period selection through the real Worker gateway", async () => {
    await project("recent");
    await project("older");
    const now = Date.now();
    await event("recent", 1, new Date(now - 86_400_000).toISOString());
    await event("older", 1, new Date(now - 14 * 86_400_000).toISOString());
    await event("older", 1, new Date(now - 13 * 86_400_000).toISOString());
    await bindings.DB.prepare("UPDATE projects SET likes_count = CASE id WHEN 'recent' THEN 1 ELSE 2 END").run();
    for (const period of ["all", "7d", "30d", "90d"] as const) {
      const url = `https://workshop.example/api/v1/projects?sort=likes&period=${period}`;
      const response = await SELF.fetch(url);
      expect(response.status).toBe(200);
      const body = projectListResponseSchema.parse(await response.json());
      expect(body.total).toBe(2);
      expect(body.items.map((item) => item.id)).toEqual(period === "7d" ? ["recent", "older"] : ["older", "recent"]);
    }
    const omitted = await SELF.fetch("https://workshop.example/api/v1/projects?sort=likes");
    const body = projectListResponseSchema.parse(await omitted.json());
    expect(body.items.map((item) => item.id)).toEqual(["older", "recent"]);
  });

  it("matches repeated primary selections with OR and only includes contained categories when requested", async () => {
    await project("role", "角色");
    await project("event", "事件");
    await project("core", "系统核心", '["合集"]', ["角色", "玩法"]);
    await project("content", "内容扩展");
    const selected = await SELF.fetch("https://workshop.test/api/v1/projects?projectType=事件&projectType=角色&projectType=角色");
    expect(selected.status).toBe(200);
    const primary = projectListResponseSchema.parse(await selected.json());
    expect(primary.items.map((item) => item.id).sort()).toEqual(["event", "role"]);
    const contained = await SELF.fetch("https://workshop.test/api/v1/projects?projectType=角色&projectType=事件&includeContained=true");
    expect(contained.status).toBe(200);
    const combined = projectListResponseSchema.parse(await contained.json());
    expect(combined.total).toBe(3);
    expect(combined.items.map((item) => item.id).sort()).toEqual(["core", "event", "role"]);
    expect(combined.items.find((item) => item.id === "core")).toMatchObject({
      projectType: "系统核心", includedTypes: ["角色", "玩法"], tags: ["合集"],
    });
    const noFilter = await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({ includeContained: true }));
    expect(noFilter.total).toBe(4);
  });

  it("ORs presets within a group, ANDs groups and every custom tag, independent of primary category", async () => {
    await project("human", "玩法", '["人类","战士","自定义甲","自定义乙"]');
    await project("elf", "事件", '["精灵/半精灵","战士","自定义甲","自定义乙"]');
    await project("wrong-identity", "角色", '["人类","法师","自定义甲","自定义乙"]');
    await project("missing-custom", "角色", '["人类","战士","自定义甲"]');
    await project("wrong-species", "角色", '["兽族","战士","自定义甲","自定义乙"]');
    const query = new URLSearchParams();
    for (const tag of ["自定义乙", "精灵/半精灵", "战士", "人类", "自定义甲", "人类"]) query.append("tag", tag);
    const response = await SELF.fetch(`https://workshop.test/api/v1/projects?${query}`);
    expect(response.status).toBe(200);
    const body = projectListResponseSchema.parse(await response.json());
    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.id).sort()).toEqual(["elf", "human"]);
    const combined = await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({
      projectType: ["玩法", "体验优化"], tag: ["战士", "人类", "精灵/半精灵", "自定义甲", "自定义乙"],
    }));
    expect(combined.items.map((item) => item.id)).toEqual(["human"]);
  });

  it("keeps cursor scope stable for equivalent repeated selections and rejects a thirteenth unique tag", async () => {
    for (const id of ["a", "b", "c"]) await project(id, "角色", '["人类","战士"]');
    const query = projectListQuerySchema.parse({ limit: 1, projectType: ["玩法", "角色"], tag: ["战士", "人类"] });
    const first = await listPublishedProjects(bindings.DB, query);
    expect(first.nextCursor).not.toBeNull();
    const equivalent = projectListQuerySchema.parse({
      limit: 1, cursor: first.nextCursor!, projectType: ["角色", "玩法", "角色"], tag: ["人类", "战士", "人类"],
    });
    expect(await isValidProjectListCursor(equivalent)).toBe(true);
    expect((await listPublishedProjects(bindings.DB, equivalent)).items.map((item) => item.id)).toEqual(["b"]);
    const tags = ["人类", "战士", ...Array.from({ length: 10 }, (_, index) => `custom${index}`)];
    const parameters = new URLSearchParams();
    for (const tag of [...tags, "人类"]) parameters.append("tag", tag);
    expect((await SELF.fetch(`https://workshop.test/api/v1/projects?${parameters}`)).status).toBe(200);
    parameters.append("tag", "thirteenth");
    expect((await SELF.fetch(`https://workshop.test/api/v1/projects?${parameters}`)).status).toBe(400);
  });

  it("paginates twelve maximum-length Unicode tags within the cursor request limit", async () => {
    const tags = Array.from({ length: 12 }, (_, index) => `${index}${"签".repeat(99)}`);
    for (const id of ["a", "b"]) await project(id, "角色", JSON.stringify(tags));
    const parameters = new URLSearchParams({ limit: "1" });
    for (const tag of tags) parameters.append("tag", tag);
    const first = await SELF.fetch(`https://workshop.test/api/v1/projects?${parameters}`);
    expect(first.status).toBe(200);
    const page = projectListResponseSchema.parse(await first.json());
    expect(page.items.map((item) => item.id)).toEqual(["b"]);
    expect(page.nextCursor).not.toBeNull();
    expect(page.nextCursor!.length).toBeLessThanOrEqual(2048);
    parameters.set("cursor", page.nextCursor!);
    const second = await SELF.fetch(`https://workshop.test/api/v1/projects?${parameters}`);
    expect(second.status).toBe(200);
    expect(projectListResponseSchema.parse(await second.json()).items.map((item) => item.id)).toEqual(["a"]);
  });

  it("rejects anonymous complete previews and returns authenticated content privately", async () => {
    await project("preview");
    await bindings.DB.prepare(
      `UPDATE project_versions SET entry_index = '{"schemaVersion":1,"entries":[]}' WHERE id = 'r-preview'`,
    ).run();
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
    expect(await response.json()).toEqual({ versionId: "r-preview", kind: "worldbook", entries: [] });
  });

  it("emits only actual like transitions and counts cancellation of an old like negatively", async () => {
    await project("negative");
    await project("zero");
    await setLike(bindings.DB, "u", "negative");
    await setLike(bindings.DB, "u", "negative");
    expect(
      (
        await bindings.DB.prepare("SELECT likes_delta FROM project_metrics_daily WHERE project_id = 'negative'").first<{
          likes_delta: number;
        }>()
      )?.likes_delta,
    ).toBe(1);
    await bindings.DB.prepare(
      "UPDATE project_metrics_daily SET day_key = '2020-01-01' WHERE project_id = 'negative'",
    ).run();
    await unsetLike(bindings.DB, "u", "negative");
    await unsetLike(bindings.DB, "u", "negative");
    expect(
      (
        await bindings.DB.prepare(
          "SELECT SUM(likes_delta) AS net FROM project_metrics_daily WHERE project_id = 'negative'",
        ).first<{ net: number }>()
      )?.net,
    ).toBe(0);
    const page = await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({ limit: 10, sort: "likes", period: "7d" }));
    expect(page.items.map((item) => item.id)).toEqual(["zero", "negative"]);
    expect(page.items[1]?.counts.likes).toBe(0);
  });

  for (const days of [7, 30, 90] as const) {
    it(`uses UTC natural ${days}-day bounds, not project age`, async () => {
      await project("inside");
      await project("outside");
      await project("negative");
      const start = Date.parse(`${asOf.slice(0, 10)}T00:00:00.000Z`) - (days - 1) * 86_400_000;
      await event("inside", 1, new Date(start).toISOString());
      await event("outside", 1, new Date(start - 1).toISOString());
      await event("outside", 1, new Date(Date.parse(asOf.slice(0, 10)) + 86_400_000).toISOString());
      await event("negative", -1, asOf);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(asOf));
      const page = await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({ limit: 10, sort: "likes", period: `${days}d` }));
      expect(page.items.map((item) => item.id)).toEqual(["inside", "outside", "negative"]);
      expect(page.total).toBe(3);
    });
  }

  it("filters the complete result, reports exact totals on every page and binds cursors to query scope", async () => {
    for (const id of ["a", "b", "c", "d", "e"]) await project(id);
    await project("other-type", "内容扩展");
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
      { projectType: ["事件"] },
      { includeContained: true },
      { tag: ["科幻"] },
      { search: "别的" },
      { authorId: "other" },
    ]) {
      expect(await isValidProjectListCursor(projectListQuerySchema.parse({ ...query, ...change, cursor: first.nextCursor! }))).toBe(false);
    }
    const second = await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({ ...query, cursor: first.nextCursor! }));
    const third = await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({ ...query, cursor: second.nextCursor! }));
    expect([second.total, third.total]).toEqual([5, 5]);
    expect([...first.items, ...second.items, ...third.items].map((item) => item.id)).toEqual(["a", "e", "d", "b", "c"]);
    expect(third.nextCursor).toBeNull();
    expect((await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({ ...query, tag: "不存在" }))).total).toBe(0);
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
      const page = await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({ limit: 10, sort, period: "all" }));
      expect(page.items.map((item) => item.id)).toEqual(["a", "b"]);
    }
    const published = await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({ limit: 10, sort: "published" }));
    expect(published.items.map((item) => item.id)).toEqual(["b", "a"]);
    const updated = await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({ limit: 10, sort: "updated" }));
    expect(updated.items.map((item) => item.updatedAt)).toEqual([
      "2026-10-26T11:00:00.000Z",
      "2026-10-26T10:00:00.000Z",
    ]);
  });

  it("applies natural-day bounds to download aggregates without writes", async () => {
    await project("inside");
    await project("outside");
    await project("future");
    const boundary = "2026-10-20T00:00:00.000Z";
    for (const [id, time] of [
      ["inside", boundary],
      ["outside", new Date(Date.parse(boundary) - 1).toISOString()],
      ["future", "2026-10-27T00:00:00.000Z"],
    ]) {
      await bindings.DB.prepare(`INSERT INTO project_metrics_daily (project_id, day_key, downloads) VALUES (?, ?, 1)`)
        .bind(id, time!.slice(0, 10))
        .run();
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(asOf));
    let reads = Infinity;
    let writes = Infinity;
    const page = await listPublishedProjects(bindings.DB, projectListQuerySchema.parse({ limit: 2, sort: "downloads", period: "7d" }), (meta) => {
      reads = meta.rows_read;
      writes = meta.rows_written;
    });
    expect(page.items.map((item) => item.id)).toEqual(["inside", "outside"]);
    expect(page.total).toBe(3);
    expect(reads).toBeLessThan(200);
    expect(writes).toBe(0);
  });
});
