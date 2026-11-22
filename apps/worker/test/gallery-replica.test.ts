import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { replicatePublicGallery, withdrawPublicGallery } from "../src/data/public-gallery";
import { sha256Hex } from "../src/storage/identity";
import { getPublishedProject } from "../src/storage/projects";
import { applySchema } from "./support/schema";

it("uses gallery originals during backfill and withdraws each public generation before changing its source", async () => {
  const { DB, R2 } = env;
  const bindings = { DB, R2, PUBLIC_COVERS: R2 };
  const origin = "https://images.example.test";
  const projectId = "p-gallery";
  const first = "first gallery image";
  const second = "second gallery image";
  const replacement = "replacement gallery image";
  const firstDigest = await sha256Hex(first);
  const secondDigest = await sha256Hex(second);
  const replacementDigest = await sha256Hex(replacement);
  const original = `gallery/${projectId}/gallery_1-${firstDigest}.png`;
  const other = `gallery/${projectId}/gallery_2-${secondDigest}.png`;
  const next = `gallery/${projectId}/gallery_1-${replacementDigest}.png`;

  await applySchema(DB);
  await DB.batch([
    DB.prepare("INSERT INTO users (id, username) VALUES ('u-gallery', 'Gallery author')"),
    DB.prepare("INSERT INTO projects (id, author_id, visibility) VALUES (?, 'u-gallery', 'public')").bind(projectId),
    DB.prepare(`INSERT INTO project_versions (id, project_id, version_no, title, project_type, created_by)
      VALUES ('v-gallery', ?, 1, 'Gallery', '角色', 'u-gallery')`).bind(projectId),
    DB.prepare("UPDATE projects SET published_version_id = 'v-gallery' WHERE id = ?").bind(projectId),
    DB.prepare(`INSERT INTO assets (id, project_id, kind, r2_key, sha256, bytes, mime)
      VALUES ('a-gallery-1', ?, 'gallery_1', ?, ?, ?, 'image/png'),
             ('a-gallery-2', ?, 'gallery_2', ?, ?, ?, 'image/png')`).bind(
      projectId,
      original,
      firstDigest,
      first.length,
      projectId,
      other,
      secondDigest,
      second.length,
    ),
  ]);
  for (const [key, value] of [
    [original, first],
    [next, replacement],
  ] as const) {
    await R2.put(key, value, { httpMetadata: { contentType: "image/png" } });
  }

  expect((await getPublishedProject(DB, projectId, origin))?.gallery).toEqual([
    { slot: 0, url: `/api/v1/public-assets/${original}` },
    { slot: 1, url: `/api/v1/public-assets/${other}` },
  ]);
  await replicatePublicGallery(bindings, projectId);
  const partial = (await getPublishedProject(DB, projectId, origin))!.gallery;
  expect(new URL(partial[0]!.url).origin).toBe(origin);
  expect(partial[1]).toEqual({ slot: 1, url: `/api/v1/public-assets/${other}` });
  await R2.put(other, second, { httpMetadata: { contentType: "image/png" } });
  await replicatePublicGallery(bindings, projectId);
  const ready = (await getPublishedProject(DB, projectId, origin))!.gallery;
  const firstKey = new URL(ready[0]!.url).pathname.slice(1);
  const secondKey = new URL(ready[1]!.url).pathname.slice(1);
  expect(firstKey).toMatch(/^covers\/gallery\//);
  expect(ready[0]).toEqual(partial[0]);
  expect(ready.map((item) => new URL(item.url).origin)).toEqual([origin, origin]);
  expect(await (await R2.get(firstKey))?.text()).toBe(first);
  expect(await (await R2.get(secondKey))?.text()).toBe(second);

  const replace = DB.prepare("UPDATE assets SET r2_key = ?, sha256 = ?, bytes = ? WHERE id = 'a-gallery-1'").bind(
    next,
    replacementDigest,
    replacement.length,
  );
  const remove = DB.prepare("DELETE FROM assets WHERE id = 'a-gallery-1'");
  const hide = DB.prepare("UPDATE projects SET visibility = 'private' WHERE id = ?").bind(projectId);
  await expect(replace.run()).rejects.toThrow("public_gallery_withdrawal_pending");
  await expect(remove.run()).rejects.toThrow("public_gallery_withdrawal_pending");
  await expect(hide.run()).rejects.toThrow("public_gallery_withdrawal_pending");

  expect(await withdrawPublicGallery(bindings, projectId, 0)).toBe(true);
  expect(await R2.get(firstKey)).toBeNull();
  await replace.run();
  expect((await getPublishedProject(DB, projectId, origin))?.gallery).toEqual([
    { slot: 0, url: `/api/v1/public-assets/${next}` },
    ready[1],
  ]);
  await replicatePublicGallery(bindings, projectId, 0);
  const newKey = new URL((await getPublishedProject(DB, projectId, origin))!.gallery[0]!.url).pathname.slice(1);
  expect(newKey).not.toBe(firstKey);
  expect(await (await R2.get(newKey))?.text()).toBe(replacement);
  expect(await (await R2.get(secondKey))?.text()).toBe(second);

  expect(await withdrawPublicGallery(bindings, projectId)).toBe(true);
  await hide.run();
  await replicatePublicGallery(bindings, projectId);
  expect(await getPublishedProject(DB, projectId, origin)).toBeNull();
  expect(await R2.get(newKey)).toBeNull();
  expect(await R2.get(secondKey)).toBeNull();
  expect(await (await R2.get(original))?.text()).toBe(first);
  expect(await (await R2.get(next))?.text()).toBe(replacement);
  expect(await (await R2.get(other))?.text()).toBe(second);
});
