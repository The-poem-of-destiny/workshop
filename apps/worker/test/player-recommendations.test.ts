import { env, SELF } from "cloudflare:test";
import type { DiscoveryResponse } from "@workshop/contracts";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { CachedReads } from "../src/data/cached-reads";
import type { DataEnv } from "../src/data/env";
import { buildRecommendationBatch, readRecommendationBatch } from "../src/storage/recommendation-batches";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const now = "2026-10-21T00:00:00.000Z";
const nowMs = Date.parse(now);
const hourMs = 3_600_000;
beforeAll(() => applySchema(bindings.DB));
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  await bindings.DB.exec(
    "DELETE FROM audit_events; DELETE FROM recommendations; DELETE FROM recommendation_batches; UPDATE projects SET working_version_id=NULL, published_version_id=NULL, published_cover_asset_id=NULL; DELETE FROM project_versions; DELETE FROM projects; DELETE FROM sessions; DELETE FROM users;",
  );
  for (const id of ["author", "player", "player-two"]) {
    await bindings.DB.prepare("INSERT INTO users(id,username,role) VALUES(?,?,'member')").bind(id, id).run();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id))), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    await bindings.DB.prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',?)",
    )
      .bind(hash, id, now)
      .run();
  }
  await bindings.DB.prepare(
    "INSERT INTO projects(id,author_id,visibility,published_at) VALUES('p','author','public',?)",
  )
    .bind(now)
    .run();
  await bindings.DB.prepare(
    "INSERT INTO project_versions(id,project_id,version_no,title,project_type,included_types,created_by,created_at) VALUES('v1','p',1,'Project','角色','[]','author',?)",
  )
    .bind(now)
    .run();
  await bindings.DB.prepare("UPDATE projects SET published_version_id='v1' WHERE id='p'").run();
});
afterEach(() => vi.useRealTimers());
function request(token: string, version: string, comment: string, method = "PUT") {
  return SELF.fetch("https://workshop.test/api/v1/recommendations/p", {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ projectVersionId: version, comment }),
  });
}
async function seedRecommendation(
  id: string,
  curatorId: string,
  comment: string,
  { version = "v1", createdAt = new Date().toISOString() } = {},
) {
  await bindings.DB.prepare(
    "INSERT INTO recommendations(id,curator_id,project_id,project_version_id,comment,created_at,updated_at) VALUES(?,?,'p',?,?,?,?)",
  )
    .bind(id, curatorId, version, comment, createdAt, new Date().toISOString())
    .run();
}
async function buildBatch() {
  const start = Date.now();
  await buildRecommendationBatch(bindings.DB, start, undefined, { start, end: start + hourMs });
}
async function discovery() {
  // Exercise the public projection without retaining cache entries between live mutations.
  const worker = new CachedReads({ props: { kind: "public" } } as unknown as ExecutionContext, {
    ...bindings,
    CACHE_TTL_PUBLIC_SECONDS: "0",
  });
  const response = await worker.fetch(
    new Request("https://cached.workshop.invalid/public/v1/api/v1/projects/discovery"),
  );
  expect(response.status).toBe(200);
  return response.json<DiscoveryResponse>();
}
it("keeps one endorsement per player/version and rejects stale publications", async () => {
  expect((await request("unknown", "v1", "text")).status).toBe(401);
  expect((await request("player", "other", "text")).status).toBe(404);
  expect((await request("player", "v1", "one")).status).toBe(200);
  expect((await request("player", "v1", "two")).status).toBe(200);
  expect(
    (await bindings.DB.prepare("SELECT curator_id,project_version_id,comment FROM recommendations").all()).results,
  ).toEqual([{ curator_id: "player", project_version_id: "v1", comment: "two" }]);
  await bindings.DB.prepare("UPDATE projects SET visibility='private' WHERE id='p'").run();
  expect((await request("player", "v1", "three")).status).toBe(404);
  expect((await request("player", "v1", "", "DELETE")).status).toBe(200);
});
it("excludes self, expired and blank comments while retaining the 90-day boundary", async () => {
  await seedRecommendation("self-rec", "author", "self");
  await bindings.DB.prepare("INSERT INTO users(id,username) VALUES('expired','expired')").run();
  await seedRecommendation("expired-rec", "expired", "expired comment", {
    createdAt: new Date(nowMs - 90 * 86_400_000 - 1).toISOString(),
  });
  await buildBatch();
  const excluded = await readRecommendationBatch(bindings.DB);
  expect(
    excluded?.items.map((item) => ({
      id: item.project_id,
      version: item.project_version_id,
      endorsements: item.contributions.endorsements,
      recommendations: item.recommendations,
    })),
  ).toEqual([{ id: "p", version: "v1", endorsements: 0, recommendations: [] }]);

  vi.setSystemTime(nowMs + hourMs);
  await seedRecommendation("player-rec", "player", "boundary comment", {
    createdAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
  });
  await seedRecommendation("blank-rec", "player-two", " \n\t ");
  await buildBatch();
  expect((await readRecommendationBatch(bindings.DB))?.items[0]?.contributions.endorsements).toBeGreaterThan(0);
  expect((await discovery()).items).toMatchObject([
    {
      id: "p",
      publishedVersionId: "v1",
      recommendations: [
        {
          id: "player-rec",
          curator: { id: "player", name: "player", avatarUrl: null },
          comment: "boundary comment",
          projectVersionId: "v1",
        },
      ],
    },
  ]);
});

it("projects all live curators and edits without changing frozen ranking through withdrawals", async () => {
  await seedRecommendation("player-rec", "player", "original comment");
  await bindings.DB.prepare("UPDATE users SET global_name='Old name',avatar='old-avatar' WHERE id='player'").run();
  await buildBatch();
  const frozen = await readRecommendationBatch(bindings.DB);
  expect(frozen?.items.map((item) => [item.project_id, item.project_version_id])).toEqual([["p", "v1"]]);
  expect(frozen?.items[0]?.contributions.endorsements).toBeGreaterThan(0);
  const frozenAccounting = {
    batchId: frozen?.batchId,
    items: frozen?.items.map(({ project_id, project_version_id, rank, pool, score, contributions }) => ({
      project_id,
      project_version_id,
      rank,
      pool,
      score,
      contributions,
    })),
  };

  await seedRecommendation("player-two-rec", "player-two", "another perspective");
  expect((await request("player", "v1", "updated comment")).status).toBe(200);
  await bindings.DB.prepare(
    "UPDATE users SET global_name='Current name',avatar='current-avatar' WHERE id='player'",
  ).run();
  const player = {
    id: "player-rec",
    curator: {
      id: "player",
      name: "Current name",
      avatarUrl: "https://cdn.discordapp.com/avatars/player/current-avatar.png",
    },
    comment: "updated comment",
    projectVersionId: "v1",
  };
  const other = {
    id: "player-two-rec",
    curator: { id: "player-two", name: "player-two", avatarUrl: null },
    comment: "another perspective",
    projectVersionId: "v1",
  };
  const current = await discovery();
  expect(current.batchId).toBe(frozen?.batchId);
  expect(
    current.items.map(({ id, publishedVersionId, recommendations }) => ({
      id,
      publishedVersionId,
      // Compare membership, not an incidental curator ordering.
      recommendations: recommendations
        .slice()
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    })),
  ).toEqual([{ id: "p", publishedVersionId: "v1", recommendations: [player, other] }]);
  expect(await readRecommendationBatch(bindings.DB)).toMatchObject(frozenAccounting);

  expect((await request("player", "v1", "", "DELETE")).status).toBe(200);
  expect(await discovery()).toMatchObject({
    batchId: frozen?.batchId,
    items: [{ id: "p", publishedVersionId: "v1", recommendations: [other] }],
  });
  expect(await readRecommendationBatch(bindings.DB)).toMatchObject(frozenAccounting);

  expect((await request("player-two", "v1", "", "DELETE")).status).toBe(200);
  expect(await discovery()).toMatchObject({
    batchId: frozen?.batchId,
    items: [{ id: "p", publishedVersionId: "v1", recommendations: [] }],
  });
  expect(await readRecommendationBatch(bindings.DB)).toMatchObject(frozenAccounting);
});

it("does not carry old endorsements into a new publication or display a deleted project", async () => {
  await seedRecommendation("old-rec", "player", "previous version comment");
  await buildBatch();
  expect((await discovery()).items).toMatchObject([
    {
      id: "p",
      publishedVersionId: "v1",
      recommendations: [{ id: "old-rec", comment: "previous version comment", projectVersionId: "v1" }],
    },
  ]);
  await bindings.DB.prepare(
    "INSERT INTO project_versions(id,project_id,version_no,title,project_type,included_types,created_by,created_at) VALUES('v2','p',2,'Updated project','角色','[]','author',?)",
  )
    .bind(now)
    .run();
  await bindings.DB.prepare("UPDATE projects SET published_version_id='v2' WHERE id='p'").run();
  expect((await discovery()).items).toEqual([]);
  expect((await request("player", "v1", "stale comment")).status).toBe(404);

  vi.setSystemTime(nowMs + hourMs);
  await buildBatch();
  expect((await discovery()).items).toMatchObject([{ id: "p", publishedVersionId: "v2", recommendations: [] }]);
  expect((await readRecommendationBatch(bindings.DB))?.items[0]?.contributions.endorsements).toBe(0);
  await seedRecommendation("current-rec", "player", "current version comment", { version: "v2" });
  expect((await discovery()).items).toMatchObject([
    {
      id: "p",
      publishedVersionId: "v2",
      recommendations: [
        {
          id: "current-rec",
          curator: { id: "player", name: "player", avatarUrl: null },
          comment: "current version comment",
          projectVersionId: "v2",
        },
      ],
    },
  ]);
  await bindings.DB.prepare("UPDATE projects SET deleted_at=? WHERE id='p'").bind(new Date().toISOString()).run();
  expect((await discovery()).items).toEqual([]);
});
