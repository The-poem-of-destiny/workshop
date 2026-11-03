import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DataEnv } from "../src/data/env";
import { applySchema } from "./support/schema";
import { splitSql } from "./support/sql";

const bindings = env as unknown as DataEnv;
const now = "2026-10-21T00:00:00.000Z";

async function hash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedSession(token: string, userId: string) {
  await bindings.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at, last_seen_at)
    VALUES (?, ?, 1, '2099-01-01T00:00:00.000Z', ?, ?)
  `)
    .bind(await hash(token), userId, now, now)
    .run();
}

function request(path: string, token: string, init?: RequestInit) {
  return SELF.fetch(new URL(path, "https://workshop.test").toString(), {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

beforeAll(() => applySchema(bindings.DB));
beforeEach(async () => {
  await bindings.DB.exec(`
    DELETE FROM audit_events; DELETE FROM recommendations; DELETE FROM site_settings;
    UPDATE projects SET working_version_id = NULL, published_version_id = NULL, published_cover_asset_id = NULL;
    DELETE FROM assets; DELETE FROM project_versions; DELETE FROM projects; DELETE FROM sessions; DELETE FROM users;
  `);
  const seedSql = `
    INSERT INTO users (id, username, global_name, role, created_at, updated_at) VALUES
      ('owner', 'owner', 'Owner', 'owner', '${now}', '${now}'),
      ('reviewer', 'reviewer', 'Reviewer', 'reviewer', '${now}', '${now}'),
      ('member', 'member', 'Member', 'member', '${now}', '${now}');
    INSERT INTO projects (id, author_id, visibility, updated_at)
      VALUES ('p1', 'member', 'public', '${now}');
    INSERT INTO project_versions(id,project_id,version_no,title,description,project_type,extension_type,created_by)
      VALUES('r1','p1',1,'Project','','角色','内容','member');
    UPDATE projects SET published_version_id = 'r1' WHERE id = 'p1';
  `;
  for (const statement of splitSql(seedSql)) await bindings.DB.prepare(statement).run();
  await seedSession("owner-token", "owner");
  await seedSession("reviewer-token", "reviewer");
});

describe("admin writes", () => {
  it("restricts owner writes and records audit events", async () => {
    const body = {
      banner: {
        imageUrl: "https://cdn/banner.webp",
        positionX: 40,
        positionY: 50,
        zoom: 1.2,
        mobilePositionX: 40,
        mobilePositionY: 50,
        mobileZoom: 1,
      },
    };
    expect(
      (await request("/api/v1/site", "reviewer-token", { method: "PUT", body: JSON.stringify(body) })).status,
    ).toBe(403);
    expect((await request("/api/v1/site", "owner-token", { method: "PUT", body: JSON.stringify(body) })).status).toBe(
      200,
    );
    expect((await request("/api/v1/admin/audit-events", "reviewer-token")).status).toBe(200);
    const events = (await (await request("/api/v1/admin/audit-events", "reviewer-token")).json()) as {
      items: Array<{ action: string }>;
    };
    expect(events.items.some((item) => item.action === "site.update")).toBe(true);
  });

  it("persists banner and serves it publicly", async () => {
    const banner = {
      imageUrl: null,
      positionX: 20,
      positionY: 30,
      zoom: 1,
      mobilePositionX: 25,
      mobilePositionY: 35,
      mobileZoom: 1.5,
    };
    expect(
      (await request("/api/v1/site", "owner-token", { method: "PUT", body: JSON.stringify({ banner }) })).status,
    ).toBe(200);
    await expect(
      (await SELF.fetch(new URL("/api/v1/site", "https://workshop.test").toString(), undefined)).json(),
    ).resolves.toMatchObject({ banner });
  });

  it("uploads a banner and registers its public URL", async () => {
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8ywACLGCSAQANEQED1LYyQAAAAABJRU5ErkJggg==",
      ),
      (value) => value.charCodeAt(0),
    );
    const uploaded = await request("/api/v1/site/banner", "reviewer-token", {
      method: "POST",
      body: png,
      headers: { "content-type": "image/png" },
    });
    expect(uploaded.status).toBe(403);
    const owner = await request("/api/v1/site/banner", "owner-token", {
      method: "POST",
      body: png,
      headers: { "content-type": "image/png" },
    });
    expect(owner.status).toBe(201);
    const body = (await owner.json()) as { banner: { imageUrl: string } };
    expect(body.banner.imageUrl).toMatch(/^\/api\/v1\/public-assets\/banners\/[a-f0-9]{64}\.png$/);
    const asset = await SELF.fetch(new URL(body.banner.imageUrl, "https://workshop.test").toString(), undefined);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("image/png");
    const mismatched = await request("/api/v1/site/banner", "owner-token", {
      method: "POST",
      body: png,
      headers: { "content-type": "image/jpeg" },
    });
    expect(mismatched.status).toBe(400);
    const oversized = await request("/api/v1/site/banner", "owner-token", {
      method: "POST",
      body: new Uint8Array(2 * 1024 * 1024 + 1),
      headers: { "content-type": "image/png" },
    });
    expect(oversized.status).toBe(413);
  });

  it("upserts and deletes recommendations", async () => {
    const put = await request("/api/v1/admin/recommendations/p1", "owner-token", {
      method: "PUT",
      body: JSON.stringify({ comment: "Great", projectVersionId: "r1" }),
    });
    expect(put.status).toBe(200);
    expect(
      (
        await bindings.DB.prepare("SELECT comment FROM recommendations WHERE project_id = 'p1'").first<{
          comment: string;
        }>()
      )?.comment,
    ).toBe("Great");
    expect((await request("/api/v1/admin/recommendations/p1", "owner-token", { method: "DELETE" })).status).toBe(204);
  });
});
