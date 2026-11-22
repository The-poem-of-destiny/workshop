import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { copyCoverReplica, deleteCoverReplica, reserveCoverReplica } from "../src/data/cover-replica";
import { replicatePublicCover, withdrawPublicCover } from "../src/data/public-covers";
import { getPublishedProject } from "../src/storage/projects";
import { applySchema } from "./support/schema";

it("rejects a stale cover copy after revocation", async () => {
  const key = `covers/${crypto.randomUUID()}`;
  const reservation = await reserveCoverReplica(env.R2, key);
  if (!reservation) throw new Error("Could not reserve a fresh cover key");
  await deleteCoverReplica(env.R2, key);
  const bytes = new TextEncoder().encode("cover bytes").buffer;
  expect(await copyCoverReplica(env.R2, key, reservation.etag, bytes, "image/png")).toBeNull();
  expect(await env.R2.get(key)).toBeNull();
});

it("does not replace an existing generation when reserving", async () => {
  const key = `covers/${crypto.randomUUID()}`;
  const reservation = await reserveCoverReplica(env.R2, key);
  if (!reservation) throw new Error("Could not reserve a fresh cover key");
  const bytes = new TextEncoder().encode("cover bytes").buffer;
  await copyCoverReplica(env.R2, key, reservation.etag, bytes, "image/png");
  expect(await reserveCoverReplica(env.R2, key)).toBeNull();
  expect(await (await env.R2.get(key))?.text()).toBe("cover bytes");
});

it("exposes only the published cover and removes its replica before going private", async () => {
  const DB = env.DB;
  await applySchema(DB);
  await DB.batch([
    DB.prepare("INSERT INTO users (id, username) VALUES ('u-cover', 'cover author')"),
    DB.prepare("INSERT INTO projects (id, author_id, visibility) VALUES ('p-cover', 'u-cover', 'public')"),
    DB.prepare(
      "INSERT INTO project_versions (id, project_id, version_no, title, project_type, created_by) VALUES ('v-cover', 'p-cover', 1, 'Cover', '角色', 'u-cover')",
    ),
    DB.prepare(
      "INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime) VALUES ('a-cover', 'p-cover', 'v-cover', 'cover', 'private/source', 'hash', 5, 'image/png')",
    ),
    DB.prepare("UPDATE projects SET published_version_id = 'v-cover' WHERE id = 'p-cover'"),
  ]);
  await env.R2.put("private/source", "cover", { httpMetadata: { contentType: "image/png" } });
  const bindings = { DB, R2: env.R2, PUBLIC_COVERS: env.R2 };
  await replicatePublicCover(bindings, "p-cover");
  const url = new URL((await getPublishedProject(DB, "p-cover", "https://images.example.test"))!.coverUrl!);
  const key = url.pathname.slice(1);
  expect(url.host).toBe("images.example.test");
  expect(await (await env.R2.get(key))?.text()).toBe("cover");
  const hide = DB.prepare("UPDATE projects SET visibility = 'private' WHERE id = 'p-cover'");
  await expect(hide.run()).rejects.toThrow("public_cover_withdrawal_pending");
  expect(await withdrawPublicCover(bindings, "p-cover")).toBe(true);
  await hide.run();
  await replicatePublicCover(bindings, "p-cover");
  expect(await env.R2.get(key)).toBeNull();
  expect(await getPublishedProject(DB, "p-cover")).toBeNull();
  expect(
    await DB.prepare("SELECT object_key FROM public_cover_replicas WHERE project_id = 'p-cover'").first(),
  ).toBeNull();
});
