import { env } from "cloudflare:test";
import { CURRENT_POLICY_VERSION } from "@workshop/domain";
import { beforeAll, expect, it } from "vitest";
import { distributionSite, distributionUpdateSite } from "../src/data/distribution-operations";
import { distributionBannerUpload } from "../src/data/distribution-streams";
import type { DataEnv } from "../src/data/env";
import { replicatePublicBanner } from "../src/data/public-banner";
import { hashSessionToken } from "../src/storage/session-hash";
import { applySchema } from "./support/schema";

const bindings: DataEnv = {
  ...(env as unknown as DataEnv),
  PUBLIC_COVERS: env.R2,
  PUBLIC_ASSETS_BASE_URL: "https://images.example.test",
  PUBLIC_ORIGIN: "https://workshop.example.test",
};
const { DB, R2 } = bindings;
const authorization = "Bearer owner-banner-token";
const framing = { positionX: 50, positionY: 50, zoom: 1, mobilePositionX: 50, mobilePositionY: 50, mobileZoom: 1 };
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8ywACLGCSAQANEQED1LYyQAAAAABJRU5ErkJggg==",
  ),
  (value) => value.charCodeAt(0),
);

beforeAll(async () => {
  await applySchema(DB);
  const now = new Date().toISOString();
  await DB.batch([
    DB.prepare(`INSERT INTO users (id, username, role, policy_accepted_version, policy_accepted_at)
      VALUES ('owner-banner', 'Owner', 'owner', ?, ?)`).bind(CURRENT_POLICY_VERSION, now),
    DB.prepare(`INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at, last_seen_at)
      VALUES (?, 'owner-banner', 1, '2099-01-01T00:00:00.000Z', ?, ?)`).bind(
      await hashSessionToken("owner-banner-token", bindings.SESSION_HASH_SECRET),
      now,
      now,
    ),
  ]);
});

it("backfills only the active banner, preserves framing edits, and withdraws the old CDN URL before replacing it", async () => {
  const privateKey = "banners/existing.png";
  const workerPath = `/api/v1/public-assets/${privateKey}`;
  const sourceUrl = `${bindings.PUBLIC_ORIGIN}/api/v1/assets/${privateKey}`;
  await R2.put(privateKey, png, { httpMetadata: { contentType: "image/png" } });
  await DB.prepare("INSERT INTO site_settings (key, value) VALUES ('discover_banner', ?)")
    .bind(JSON.stringify({ ...framing, imageUrl: sourceUrl }))
    .run();
  expect((await distributionSite(bindings)).banner?.imageUrl).toBe(workerPath);

  await replicatePublicBanner(bindings);
  const ready = (await distributionSite(bindings)).banner;
  if (!ready?.imageUrl) throw new Error("Backfilled banner has no CDN URL");
  const firstUrl = new URL(ready.imageUrl);
  const firstKey = firstUrl.pathname.slice(1);
  expect(firstUrl.origin).toBe(bindings.PUBLIC_ASSETS_BASE_URL);
  expect(new Uint8Array(await (await R2.get(firstKey))!.arrayBuffer())).toEqual(png);
  expect(await distributionUpdateSite(bindings, authorization, { banner: { ...ready, positionX: 14 } })).toMatchObject({
    kind: "ok",
    data: { banner: { imageUrl: firstUrl.href, positionX: 14 } },
  });

  const response = await distributionBannerUpload(
    new Request(`${bindings.PUBLIC_ORIGIN}/api/v1/site/banner`, {
      method: "POST",
      headers: { authorization, "content-type": "image/png", "content-length": String(png.length) },
      body: png,
    }),
    bindings,
  );
  expect(response.status).toBe(201);
  const next = (await distributionSite(bindings)).banner;
  if (!next?.imageUrl) throw new Error("Replacement banner has no CDN URL");
  const nextUrl = new URL(next.imageUrl);
  const nextKey = nextUrl.pathname.slice(1);
  expect(nextUrl.origin).toBe(bindings.PUBLIC_ASSETS_BASE_URL);
  expect(nextKey).not.toBe(firstKey);
  expect(next.positionX).toBe(14);
  expect(await R2.head(firstKey)).toBeNull();
  expect(new Uint8Array(await (await R2.get(privateKey))!.arrayBuffer())).toEqual(png);

  expect(await distributionUpdateSite(bindings, authorization, { banner: { ...next, imageUrl: null } })).toMatchObject({
    kind: "ok",
    data: { banner: { imageUrl: null } },
  });
  expect(await distributionUpdateSite(bindings, authorization, { banner: next })).toMatchObject({ kind: "conflict" });
  await replicatePublicBanner(bindings);
  expect((await distributionSite(bindings)).banner?.imageUrl).toBeNull();
  expect(await R2.head(nextKey)).toBeNull();
  expect((await R2.list({ prefix: "covers/banner/" })).objects).toEqual([]);
});

it("does not reinstate a banner when owner settings clear it during an upload", async () => {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  expect(
    await distributionUpdateSite(bindings, authorization, {
      banner: { ...framing, imageUrl: "https://external.example.test/banner.png" },
    }),
  ).toMatchObject({ kind: "ok" });
  const upload = distributionBannerUpload(
    new Request(`${bindings.PUBLIC_ORIGIN}/api/v1/site/banner`, {
      method: "POST",
      headers: { authorization, "content-type": "image/png", "content-length": String(png.length) },
      body: stream.readable,
    }),
    bindings,
  );
  try {
    // The write waits for the upload to consume its body, after reading its settings snapshot.
    await Promise.race([
      writer.write(png),
      upload.then(() => {
        throw new Error("Upload returned before reading its body");
      }),
    ]);
    expect(
      await distributionUpdateSite(bindings, authorization, { banner: { ...framing, imageUrl: null } }),
    ).toMatchObject({
      kind: "ok",
    });
  } finally {
    await writer.close();
  }
  expect((await upload).status).toBe(409);
  expect((await distributionSite(bindings)).banner?.imageUrl).toBeNull();
  expect((await R2.list({ prefix: "covers/banner/" })).objects).toEqual([]);
});
