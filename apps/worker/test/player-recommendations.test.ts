import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { DataEnv } from "../src/data/env";
import { buildRecommendationBatch, readRecommendationBatch } from "../src/storage/recommendation-batches";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const now = "2026-10-21T00:00:00.000Z";
beforeAll(() => applySchema(bindings.DB));
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  await bindings.DB.exec(
    "DELETE FROM audit_events; DELETE FROM recommendations; DELETE FROM recommendation_batches; UPDATE projects SET working_version_id=NULL, published_version_id=NULL, published_cover_asset_id=NULL; DELETE FROM project_versions; DELETE FROM projects; DELETE FROM sessions; DELETE FROM users;",
  );
  for (const id of ["author", "player"]) {
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
    "INSERT INTO project_versions(id,project_id,version_no,title,project_type,created_by,created_at) VALUES('v1','p',1,'Project','角色','author',?)",
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
it("excludes self endorsements and stops displaying withdrawn comments immediately", async () => {
  await request("author", "v1", "self");
  await buildRecommendationBatch(bindings.DB, new Date(now), undefined, {
    start: Date.parse(now),
    end: Date.parse(now) + 3_600_000,
  });
  let run = await readRecommendationBatch(bindings.DB, Date.parse(now));
  expect(run?.items[0]?.contributions.endorsements).toBe(0);
  expect(run?.items[0]?.recommendationComment).toBeNull();
  await request("player", "v1", "player comment");
  // Keep the fixture endorsement within the frozen calculation's freshness window.
  await bindings.DB.prepare("UPDATE recommendations SET updated_at=?").bind(now).run();
  await buildRecommendationBatch(bindings.DB, new Date(now), undefined, {
    start: Date.parse(now) - 3_600_000,
    end: Date.parse(now) + 3_600_000,
  });
  run = await readRecommendationBatch(bindings.DB, Date.parse(now));
  expect(run?.items[0]?.contributions.endorsements).toBeGreaterThan(0);
  expect(run?.items[0]?.recommendationComment).toBe("player comment");
  await request("player", "v1", "", "DELETE");
  expect((await readRecommendationBatch(bindings.DB, Date.parse(now)))?.items[0]?.recommendationComment).toBeNull();
});
