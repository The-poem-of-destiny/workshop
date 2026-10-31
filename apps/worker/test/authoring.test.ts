import { env, SELF } from "cloudflare:test";
import { type Session, uploadResponseSchema } from "@workshop/contracts";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contentBaselineConflict } from "../src/data/content-operations";
import type { DataEnv } from "../src/data/env";

import { listAuthorProjects } from "../src/storage/authoring";
import { upsertStreamedAsset } from "../src/storage/authoring-assets";
import { loadWorldbookAsset } from "../web/src/features/projects/authoring/preview";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const now = "2026-10-21T00:00:00.000Z";
const validWorldbook = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "Text" }] });
const validWorldbookBytes = new TextEncoder().encode(validWorldbook).byteLength;
const markedWorldbook = JSON.stringify({ entries: [{ uid: 1, name: "[WS] Entry", content: "Text" }] });

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function upsertAsset(
  db: D1Database,
  r2: R2Bucket,
  projectId: string,
  revisionId: string,
  expectedVersion: number,
  kind: Parameters<typeof upsertStreamedAsset>[4],
  body: ArrayBuffer,
  mime: string,
  entryCount?: number,
) {
  const digest = await crypto.subtle.digest("SHA-256", body);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return upsertStreamedAsset(
    db,
    projectId,
    revisionId,
    expectedVersion,
    kind,
    sha256,
    body.byteLength,
    mime,
    entryCount,
    async (key, options) => {
      await r2.put(key, body, options);
    },
  );
}

async function seedUser(id: string, role: "member" | "owner" = "member", token = `${id}-token`) {
  await bindings.DB.prepare("INSERT INTO users (id, username, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, id, role, now, now)
    .run();
  await bindings.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(await tokenHash(token), id, "2099-01-01T00:00:00.000Z")
    .run();
}

async function request(path: string, init: RequestInit = {}, token = "author-token") {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return SELF.fetch("https://workshop.test/api/v1/projects" + (path === "/" ? "" : path), { ...init, headers });
}

beforeAll(async () => {
  await applySchema(bindings.DB);
  bindings.DISCORD_ALLOWED_GUILD_IDS = "123456789012345678";
});

beforeEach(async () => {
  await bindings.DB.exec(`
    DELETE FROM project_gallery;
    DELETE FROM audit_events;
    DELETE FROM reference_items;
    DELETE FROM reference_versions;
    DELETE FROM reference_sets;
    DELETE FROM reviews;
    DELETE FROM project_likes;
    DELETE FROM project_subscriptions;
    DELETE FROM project_ratings;
    DELETE FROM submissions;
    DELETE FROM assets;
    DELETE FROM project_revisions;
    DELETE FROM projects;
    DELETE FROM sessions;
    DELETE FROM users;
  `);
  await seedUser("author");
  await seedUser("other");
  await seedUser("owner", "owner");
});

describe("authoring write paths", () => {
  it("stores marked final worldbook names without rewriting references", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Names" }) });
    const draft = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    const source = JSON.stringify({
      entries: {
        one: { comment: "Library", content: "data" },
        two: { name: "[WS] Caller", content: "<%- await getwi(/^\\[WS\\] Library$/) %>" },
      },
    });
    const preview = await loadWorldbookAsset(new File([source], "book.json"));
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.value.entries.map((entry) => entry.name)).toEqual(["[WS] Library", "[WS] Caller"]);
    const path = `/${draft.project.id}/revisions/${draft.workingRevisionId}/files/worldbook`;
    const uploaded = await request(path, {
      method: "PUT",
      body: source,
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(source).length),
        "if-match": "1",
      },
    });
    expect(uploaded.status).toBe(200);
    const saved = (await (await request(path)).json()) as {
      entries: Record<string, { name: string; comment?: string; content: string }>;
    };
    expect(JSON.parse(preview.value.text)).toEqual(saved);
    expect(saved.entries.one).toEqual({ name: "[WS] Library", comment: "[WS] Library", content: "data" });
    expect(saved.entries.two).toEqual({ name: "[WS] Caller", content: "<%- await getwi(/^\\[WS\\] Library$/) %>" });
  });
  it("creates projects and enforces the row-version CAS", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "New project", description: "draft", tags: ["tag"] }),
      headers: { "content-type": "application/json" },
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      project: { id: string; visibility: string };
      rowVersion: number;
      workingRevisionId: string;
    };
    expect(body.project.visibility).toBe("private");
    expect(body.rowVersion).toBe(1);
    expect(body.workingRevisionId).toBeTruthy();

    const mismatch = await request(`/${body.project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": "99" },
      body: JSON.stringify({ title: "stale" }),
    });
    expect(mismatch.status).toBe(412);
    await expect(mismatch.json()).resolves.toMatchObject({
      error: {
        code: "precondition_failed",
        details: { resource: "project", expectedVersion: 99, currentVersion: 1 },
      },
    });
  });

  it("accepts only one concurrent metadata update with the same version", async () => {
    const created = await request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Concurrent project" }),
    });
    const { project, rowVersion } = (await created.json()) as { project: { id: string }; rowVersion: number };
    const update = (title: string) =>
      request(`/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "if-match": String(rowVersion) },
        body: JSON.stringify({ title }),
      });
    const responses = await Promise.all([update("First"), update("Second")]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
    const conflict = responses.find((response) => response.status === 412);
    await expect(conflict!.json()).resolves.toMatchObject({ error: { code: "precondition_failed" } });
  });

  it("hides projects from non-authors and permits owners", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Private" }) });
    const { project, workingRevisionId } = (await created.json()) as {
      project: { id: string };
      workingRevisionId: string;
    };
    const forbidden = await request(
      `/${project.id}`,
      { method: "PATCH", headers: { "if-match": "1" }, body: JSON.stringify({ title: "Nope" }) },
      "other-token",
    );
    expect(forbidden.status).toBe(404);
    expect((await request(`/${project.id}/draft`, {}, "other-token")).status).toBe(404);
    const draft = await request(`/${project.id}/draft`);
    expect(draft.status).toBe(200);
    await expect(draft.json()).resolves.toMatchObject({
      project: { id: project.id },
      rowVersion: 1,
      workingRevisionId,
    });
    const allowed = await request(
      `/${project.id}`,
      { method: "PATCH", headers: { "if-match": "1" }, body: JSON.stringify({ title: "owner edit" }) },
      "owner-token",
    );
    expect(allowed.status).toBe(200);
  });

  it("keeps revision numbers immutable and uploads hashed assets", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Versions" }) });
    const first = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    const revision = await request(`/${first.project.id}/revisions`, {
      method: "POST",
      headers: { "if-match": "1" },
      body: JSON.stringify({ title: "Second" }),
    });
    expect(revision.status).toBe(201);
    const second = (await revision.json()) as { revisionId: string; rowVersion: number };
    const upload = await request(`/${first.project.id}/revisions/${second.revisionId}/files/worldbook`, {
      method: "PUT",
      body: validWorldbook,
      headers: {
        "content-type": "application/json",
        "content-length": String(validWorldbookBytes),
        "if-match": String(second.rowVersion),
      },
    });
    expect(upload.status).toBe(200);
    await expect(upload.json()).resolves.toMatchObject({
      kind: "worldbook",
      bytes: new TextEncoder().encode(markedWorldbook).byteLength,
      mime: "application/json",
      rowVersion: 3,
    });
    const inherited = await request(`/${first.project.id}/revisions`, {
      method: "POST",
      headers: { "if-match": "3" },
      body: JSON.stringify({ title: "Third" }),
    });
    expect(inherited.status).toBe(201);
    const inheritedRevision = (await inherited.json()) as { revisionId: string };
    await expect((await request(`/${first.project.id}/draft`)).json()).resolves.toMatchObject({
      workingRevisionId: inheritedRevision.revisionId,
      project: { entries: { worldbook: 1, regex: 0 } },
    });
    expect(
      await (await request(`/${first.project.id}/revisions/${inheritedRevision.revisionId}/files/worldbook`)).text(),
    ).toBe(markedWorldbook);
    const listed = await bindings.R2.list({
      prefix: `projects/${first.project.id}/revisions/${second.revisionId}/worldbook-`,
    });
    expect(listed.objects).toHaveLength(1);
    const object = await bindings.R2.get(listed.objects[0]!.key);
    await expect(object?.text()).resolves.toBe(markedWorldbook);
    const rows = await bindings.DB.prepare(
      "SELECT revision_no FROM project_revisions WHERE project_id = ? ORDER BY revision_no",
    )
      .bind(first.project.id)
      .all<{ revision_no: number }>();
    expect(rows.results.map((row) => row.revision_no)).toEqual([1, 2, 3]);
  });

  it("supports two gallery slots with real image validation and CAS", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Gallery" }) });
    const { project } = (await created.json()) as { project: { id: string } };
    const png = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196,
      137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0,
      0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]);
    const upload = await request(`/${project.id}/gallery/0`, {
      method: "PUT",
      body: png,
      headers: { "content-type": "image/png", "content-length": String(png.byteLength), "if-match": "1" },
    });
    expect(upload.status).toBe(200);
    const stored = await bindings.DB.prepare("SELECT r2_key FROM project_gallery WHERE project_id = ? AND slot = 0")
      .bind(project.id)
      .first<{ r2_key: string }>();
    await bindings.DB.prepare(`
      CREATE TRIGGER fail_gallery_row_update
      BEFORE UPDATE OF row_version ON projects
      BEGIN SELECT RAISE(FAIL, 'gallery test failure'); END;
    `).run();
    const failedRetry = await request(`/${project.id}/gallery/0`, {
      method: "PUT",
      body: png,
      headers: { "content-type": "image/png", "content-length": String(png.byteLength), "if-match": "2" },
    });
    expect(failedRetry.status).toBe(400);
    expect(stored?.r2_key).toBeTruthy();
    await expect(bindings.R2.get(stored!.r2_key)).resolves.not.toBeNull();
    await bindings.DB.exec("DROP TRIGGER fail_gallery_row_update");
    const unauthorized = await request(`/${project.id}/gallery`, {}, "other-token");
    expect(unauthorized.status).toBe(404);
    const stale = await request(`/${project.id}/gallery/1`, {
      method: "PUT",
      body: png,
      headers: { "content-type": "image/png", "content-length": String(png.byteLength), "if-match": "1" },
    });
    expect(stale.status).toBe(412);
    const invalidSlot = await request(`/${project.id}/gallery/2`, {
      method: "PUT",
      body: png,
      headers: { "content-type": "image/png", "content-length": String(png.byteLength), "if-match": "2" },
    });
    expect(invalidSlot.status).toBe(400);
    const wrongMime = await request(`/${project.id}/gallery/1`, {
      method: "PUT",
      body: png,
      headers: { "content-type": "image/jpeg", "content-length": String(png.byteLength), "if-match": "2" },
    });
    expect(wrongMime.status).toBe(400);
    const second = await request(`/${project.id}/gallery/1`, {
      method: "PUT",
      body: png,
      headers: { "content-type": "image/png", "content-length": String(png.byteLength), "if-match": "2" },
    });
    expect(second.status).toBe(200);
    await expect((await request(`/${project.id}/gallery`)).json()).resolves.toMatchObject({
      rowVersion: 3,
      images: [{ slot: 0 }, { slot: 1 }],
    });
  });

  it("deletes one entry into a new revision without touching the old asset", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Entries" }) });
    const first = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    const twoEntries = JSON.stringify({
      entries: [
        { uid: 1, name: "One", content: "a" },
        { uid: 2, name: "Two", content: "b" },
      ],
    });
    const bytes = new TextEncoder().encode(twoEntries).byteLength;
    const initialUpload = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: twoEntries,
      headers: { "content-type": "application/json", "content-length": String(bytes), "if-match": "1" },
    });
    const uploadedWorldbook = (await initialUpload.json()) as { rowVersion: number };
    const savedPath = `/${first.project.id}/revisions/${first.workingRevisionId}/files/worldbook`;
    const saved = await request(savedPath);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("private, no-store");
    const normalized = JSON.stringify({
      entries: [
        { uid: 1, name: "[WS] One", content: "a" },
        { uid: 2, name: "[WS] Two", content: "b" },
      ],
    });
    expect(await saved.text()).toBe(normalized);
    expect((await request(savedPath, {}, "other-token")).status).toBe(404);
    expect((await request(savedPath, {}, "owner-token")).status).toBe(200);
    expect((await SELF.fetch("https://workshop.test/api/v1/projects" + savedPath, {})).status).toBe(401);
    const unrelated = await request("/", { method: "POST", body: JSON.stringify({ title: "Other project" }) });
    const otherProject = (await unrelated.json()) as { project: { id: string } };
    expect(
      (await request(`/${otherProject.project.id}/revisions/${first.workingRevisionId}/files/worldbook`)).status,
    ).toBe(404);
    const cover = new TextEncoder().encode("cover-bytes").buffer;
    const uploadedCover = await upsertAsset(
      bindings.DB,
      bindings.R2,
      first.project.id,
      first.workingRevisionId,
      uploadedWorldbook.rowVersion,
      "cover",
      cover,
      "image/webp",
    );
    const regex = new TextEncoder().encode(
      JSON.stringify({ scriptName: "Keep", findRegex: "/a/g", replaceString: "b" }),
    ).buffer;
    const uploadedRegex = await upsertAsset(
      bindings.DB,
      bindings.R2,
      first.project.id,
      first.workingRevisionId,
      uploadedCover!.rowVersion,
      "regex",
      regex,
      "application/json",
      1,
    );
    const oldCover = await bindings.DB.prepare("SELECT r2_key FROM assets WHERE revision_id = ? AND kind = 'cover'")
      .bind(first.workingRevisionId)
      .first<{ r2_key: string }>();
    expect(oldCover).not.toBeNull();
    const staleDelete = await request(
      `/${first.project.id}/revisions/${first.workingRevisionId}/entries/worldbook/${encodeURIComponent("uid:1")}`,
      { method: "DELETE", headers: { "if-match": "1" } },
    );
    expect(staleDelete.status).toBe(409);

    const deleted = await request(
      `/${first.project.id}/revisions/${first.workingRevisionId}/entries/worldbook/${encodeURIComponent("uid:1")}`,
      { method: "DELETE", headers: { "if-match": String(uploadedRegex!.rowVersion) } },
    );
    expect(deleted.status).toBe(200);
    const result = (await deleted.json()) as { rowVersion: number; revisionId: string; entryCount: number };
    expect(result.rowVersion).toBe(5);
    expect(result.entryCount).toBe(1);
    expect(result.revisionId).not.toBe(first.workingRevisionId);
    const draft = await request(`/${first.project.id}/draft`);
    await expect(draft.json()).resolves.toMatchObject({ workingRevisionId: result.revisionId, rowVersion: 5 });
    const asset = await bindings.DB.prepare("SELECT r2_key FROM assets WHERE revision_id = ? AND kind = 'worldbook'")
      .bind(result.revisionId)
      .first<{ r2_key: string }>();
    const worldbookCount = await bindings.DB.prepare("SELECT worldbook_count FROM project_revisions WHERE id = ?")
      .bind(result.revisionId)
      .first<{ worldbook_count: number }>();
    expect(worldbookCount?.worldbook_count).toBe(1);
    const text = await (await bindings.R2.get(asset!.r2_key))?.text();
    expect(JSON.parse(text ?? "{}").entries).toEqual([{ uid: 2, name: "[WS] Two", content: "b" }]);
    const oldAsset = await bindings.DB.prepare("SELECT r2_key FROM assets WHERE revision_id = ? AND kind = 'worldbook'")
      .bind(first.workingRevisionId)
      .first<{ r2_key: string }>();
    expect(oldAsset?.r2_key).not.toBe(asset?.r2_key);
    await expect((await bindings.R2.get(oldAsset!.r2_key))?.text()).resolves.toBe(normalized);
    const published = await bindings.DB.prepare("SELECT published_revision_id FROM projects WHERE id = ?")
      .bind(first.project.id)
      .first<{ published_revision_id: string | null }>();
    expect(published?.published_revision_id).toBeNull();

    const retainedCover = await bindings.DB.prepare(
      "SELECT r2_key FROM assets WHERE revision_id = ? AND kind = 'cover'",
    )
      .bind(result.revisionId)
      .first<{ r2_key: string }>();
    expect(retainedCover?.r2_key).toBe(oldCover?.r2_key);
    const retainedObject = await bindings.R2.get(retainedCover!.r2_key);
    await expect(retainedObject?.text()).resolves.toBe("cover-bytes");
    const counts = await bindings.DB.prepare("SELECT worldbook_count, regex_count FROM project_revisions WHERE id = ?")
      .bind(result.revisionId)
      .first<{ worldbook_count: number; regex_count: number }>();
    expect(counts).toEqual({ worldbook_count: 1, regex_count: 1 });
  });
  it("keeps published bytes unchanged and rejects deleting the required final draft entry", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "Published entries", projectType: "角色" }),
    });
    const first = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    const text = JSON.stringify({
      entries: [
        { uid: 1, content: "one" },
        { uid: 2, content: "two" },
      ],
    });
    const uploaded = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: text,
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(text).byteLength),
        "if-match": "1",
      },
    });
    const upload = (await uploaded.json()) as { rowVersion: number };
    await bindings.DB.prepare(
      "UPDATE projects SET published_revision_id = ?, visibility = 'public', published_at = ? WHERE id = ?",
    )
      .bind(first.workingRevisionId, now, first.project.id)
      .run();
    const revision = await request(`/${first.project.id}/revisions`, {
      method: "POST",
      headers: { "if-match": String(upload.rowVersion) },
      body: JSON.stringify({ title: "Draft" }),
    });
    const draft = (await revision.json()) as { revisionId: string; rowVersion: number };
    const deleted = await request(
      `/${first.project.id}/revisions/${draft.revisionId}/entries/worldbook/${encodeURIComponent("uid:1")}`,
      {
        method: "DELETE",
        headers: { "if-match": String(draft.rowVersion) },
      },
    );
    expect(deleted.status).toBe(200);
    const successor = (await deleted.json()) as { revisionId: string; rowVersion: number };
    const finalDelete = await request(
      `/${first.project.id}/revisions/${successor.revisionId}/entries/worldbook/${encodeURIComponent("uid:2")}`,
      {
        method: "DELETE",
        headers: { "if-match": String(successor.rowVersion) },
      },
    );
    expect(finalDelete.status).toBe(409);
    const state = await bindings.DB.prepare(
      "SELECT published_revision_id, working_revision_id, row_version FROM projects WHERE id = ?",
    )
      .bind(first.project.id)
      .first();
    expect(state).toMatchObject({
      published_revision_id: first.workingRevisionId,
      working_revision_id: successor.revisionId,
      row_version: successor.rowVersion,
    });
    const original = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/worldbook`);
    expect(await original.text()).toBe(
      JSON.stringify({
        entries: [
          { uid: 1, content: "one", name: "[WS] " },
          { uid: 2, content: "two", name: "[WS] " },
        ],
      }),
    );
  });

  it("leaves the working revision unchanged when a retained asset is missing", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Missing retained" }) });
    const first = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    const entries = JSON.stringify({
      entries: [
        { uid: 1, name: "One", content: "a" },
        { uid: 2, name: "Two", content: "b" },
      ],
    });
    const initialUpload = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: entries,
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(entries).byteLength),
        "if-match": "1",
      },
    });
    const uploadedWorldbook = (await initialUpload.json()) as { rowVersion: number };
    const cover = new TextEncoder().encode("missing-cover").buffer;
    const uploaded = await upsertAsset(
      bindings.DB,
      bindings.R2,
      first.project.id,
      first.workingRevisionId,
      uploadedWorldbook.rowVersion,
      "cover",
      cover,
      "image/webp",
    );
    await bindings.R2.delete(uploaded!.r2Key);

    const deleted = await request(
      `/${first.project.id}/revisions/${first.workingRevisionId}/entries/worldbook/${encodeURIComponent("uid:1")}`,
      { method: "DELETE", headers: { "if-match": String(uploaded!.rowVersion) } },
    );
    expect(deleted.status).toBe(500);
    const project = await bindings.DB.prepare("SELECT working_revision_id, row_version FROM projects WHERE id = ?")
      .bind(first.project.id)
      .first<{ working_revision_id: string; row_version: number }>();
    expect(project).toEqual({ working_revision_id: first.workingRevisionId, row_version: 3 });
    const count = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM project_revisions WHERE project_id = ?")
      .bind(first.project.id)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("supersedes pending submissions and rejects unsupported/oversized uploads", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Submit" }) });
    const first = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    const upload = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: validWorldbook,
      headers: { "content-type": "application/json", "content-length": String(validWorldbookBytes), "if-match": "1" },
    });
    expect(upload.status).toBe(200);
    const uploaded = (await upload.json()) as { rowVersion: number };
    const submit = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/submit`, {
      method: "POST",
      headers: { "if-match": String(uploaded.rowVersion) },
      body: JSON.stringify({ gate: "block", checkerRevision: "c1" }),
    });
    expect(submit.status).toBe(201);
    const current = await bindings.DB.prepare("SELECT row_version FROM projects WHERE id = ?")
      .bind(first.project.id)
      .first<{ row_version: number }>();
    const frozenDelete = await request(
      `/${first.project.id}/revisions/${first.workingRevisionId}/entries/worldbook/${encodeURIComponent("uid:1")}`,
      { method: "DELETE", headers: { "if-match": String(current!.row_version) } },
    );
    expect(frozenDelete.status).toBe(409);
    const firstSubmission = (await submit.json()) as { rowVersion: number };

    // A submitted revision cannot be submitted or uploaded again.
    const resubmit = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/submit`, {
      method: "POST",
      headers: { "if-match": String(current!.row_version) },
      body: JSON.stringify({ gate: "warn", checkerRevision: "c1" }),
    });
    expect(resubmit.status).toBe(409);
    const forbidden = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/nope`, {
      method: "PUT",
      body: "x",
    });
    expect(forbidden.status).toBe(400);
    const frozen = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: validWorldbook,
      headers: {
        "content-type": "application/json",
        "content-length": String(validWorldbookBytes),
        "if-match": String(current!.row_version),
      },
    });
    expect(frozen.status).toBe(404);

    // Storage-level guard closes the check-then-act window after submit.
    const raced = await upsertAsset(
      bindings.DB,
      bindings.R2,
      first.project.id,
      first.workingRevisionId,
      firstSubmission.rowVersion,
      "worldbook",
      new TextEncoder().encode(validWorldbook).buffer,
      "application/json",
      1,
    );
    expect(raced).toBeNull();
    const manifest = await bindings.DB.prepare("SELECT manifest_hash FROM project_revisions WHERE id = ?")
      .bind(first.workingRevisionId)
      .first<{ manifest_hash: string | null }>();
    expect(manifest?.manifest_hash).toMatch(/^[0-9a-f]{64}$/);

    // A successor submission supersedes the earlier unresolved submission.
    const next = await request(`/${first.project.id}/revisions`, {
      method: "POST",
      headers: { "if-match": String(firstSubmission.rowVersion) },
      body: JSON.stringify({ title: "Third" }),
    });
    expect(next.status).toBe(201);
    const third = (await next.json()) as { revisionId: string; rowVersion: number };
    const successorUpload = await request(`/${first.project.id}/revisions/${third.revisionId}/files/worldbook`, {
      method: "PUT",
      body: validWorldbook,
      headers: {
        "content-type": "application/json",
        "content-length": String(validWorldbookBytes),
        "if-match": String(third.rowVersion),
      },
    });
    const successorAsset = (await successorUpload.json()) as { rowVersion: number };
    const successorSubmit = await request(`/${first.project.id}/revisions/${third.revisionId}/submit`, {
      method: "POST",
      headers: { "if-match": String(successorAsset.rowVersion) },
      body: JSON.stringify({ gate: "block", checkerRevision: "c1" }),
    });
    expect(successorSubmit.status).toBe(201);
    const successor = (await successorSubmit.json()) as { submissionId: string };
    // Stage the queued successor without starting submit's background checker.
    await bindings.DB.prepare(`
      UPDATE submissions SET client_gate = 'warn', status = 'checking', check_status = 'queued'
      WHERE id = ?
    `)
      .bind(successor.submissionId)
      .run();
    const statuses = await bindings.DB.prepare("SELECT revision_id, status FROM submissions WHERE project_id = ?")
      .bind(first.project.id)
      .all<{ revision_id: string; status: string }>();
    expect(statuses.results).toHaveLength(2);
    expect(statuses.results).toEqual(
      expect.arrayContaining([
        { revision_id: first.workingRevisionId, status: "superseded" },
        { revision_id: third.revisionId, status: "checking" },
      ]),
    );

    // Use an independent draft for the upload limit check.
    const fresh = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "Upload limit" }),
    });
    expect(fresh.status).toBe(201);
    const fourth = (await fresh.json()) as { project: { id: string }; workingRevisionId: string; rowVersion: number };
    const oversized = await request(`/${fourth.project.id}/revisions/${fourth.workingRevisionId}/files/cover`, {
      method: "PUT",
      body: "x",
      headers: {
        "content-type": "image/png",
        "content-length": String(10 * 1024 * 1024 + 1),
        "if-match": String(fourth.rowVersion),
      },
    });
    expect(oversized.status).toBe(413);
  });

  it("does not allow metadata edits to rewrite a submitted review snapshot", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "Submitted snapshot", projectType: "角色" }),
    });
    const first = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    const upload = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: validWorldbook,
      headers: { "content-type": "application/json", "content-length": String(validWorldbookBytes), "if-match": "1" },
    });
    const uploaded = (await upload.json()) as { rowVersion: number };
    const submission = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/submit`, {
      method: "POST",
      headers: { "if-match": String(uploaded.rowVersion) },
      body: JSON.stringify({}),
    });
    expect(submission.status).toBe(201);
    await submission.json();

    await bindings.DB.prepare("UPDATE projects SET published_revision_id = ? WHERE id = ?")
      .bind(first.workingRevisionId, first.project.id)
      .run();
    const current = await bindings.DB.prepare("SELECT row_version FROM projects WHERE id = ?")
      .bind(first.project.id)
      .first<{ row_version: number }>();
    const edited = await request(`/${first.project.id}`, {
      method: "PATCH",
      headers: { "if-match": String(current!.row_version) },
      body: JSON.stringify({ title: "Changed after submit", projectType: "扩展", tags: ["规则"] }),
    });
    expect(edited.status).toBe(409);
    const snapshot = await bindings.DB.prepare("SELECT title, project_type, tags FROM project_revisions WHERE id = ?")
      .bind(first.workingRevisionId)
      .first<{ title: string; project_type: string; tags: string }>();
    expect(snapshot).toEqual({ title: "Submitted snapshot", project_type: "角色", tags: "[]" });
  });

  it("rejects a submission containing an entry identical to an official baseline item", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Baseline" }) });
    const project = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    const upload = await request(`/${project.project.id}/revisions/${project.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: validWorldbook,
      headers: { "content-type": "application/json", "content-length": String(validWorldbookBytes), "if-match": "1" },
    });
    expect(upload.status).toBe(200);
    const uploaded = (await upload.json()) as { rowVersion: number };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify({ name: "Entry", content: "Text" })),
    );
    const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await bindings.DB.prepare(`
      INSERT INTO reference_sets (id, name, created_by) VALUES ('rs1', 'Baseline', 'author');
      INSERT INTO reference_versions (id, reference_set_id, version_label, version_ordinal, grace_until, created_by)
        VALUES ('rv1', 'rs1', 'v1', 1, '2099-01-01T00:00:00.000Z', 'author');
      INSERT INTO reference_items (id, reference_version_id, kind, display_name, exact_hash, normalized_content_hash, name_hash, structure_hash)
        VALUES ('ri1', 'rv1', 'worldbook', 'Official', ?, 'n', 'h', 's');
    `)
      .bind(fingerprint)
      .run();
    const submitted = await request(`/${project.project.id}/revisions/${project.workingRevisionId}/submit`, {
      method: "POST",
      headers: { "if-match": String(uploaded.rowVersion) },
      body: JSON.stringify({ gate: "pass" }),
    });
    expect(submitted.status).toBe(400);
    const count = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM submissions WHERE project_id = ?")
      .bind(project.project.id)
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("submits large worldbooks and detects official matches in later fingerprint batches", async () => {
    const entries = Array.from({ length: 120 }, (_, uid) => ({ uid, name: `Entry ${uid}`, content: `Content ${uid}` }));
    const text = JSON.stringify({ entries });
    async function uploadAndSubmit(title: string) {
      const created = await request("/", { method: "POST", body: JSON.stringify({ title }) });
      const project = (await created.json()) as { project: { id: string }; workingRevisionId: string };
      const path = `/${project.project.id}/revisions/${project.workingRevisionId}`;
      const upload = await request(`${path}/files/worldbook`, {
        method: "PUT",
        body: text,
        headers: {
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(text).length),
          "if-match": "1",
        },
      });
      expect(upload.status).toBe(200);
      const uploaded = (await upload.json()) as { rowVersion: number };
      const submitted = await request(`${path}/submit`, {
        method: "POST",
        headers: { "if-match": String(uploaded.rowVersion) },
        body: JSON.stringify({ gate: "pass" }),
      });
      return { project, submitted };
    }
    const first = await uploadAndSubmit("Large valid book");
    expect(first.submitted.status).toBe(201);
    const indexed = await bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM revision_entry_index WHERE revision_id = ?",
    )
      .bind(first.project.workingRevisionId)
      .first<{ count: number }>();
    expect(indexed?.count).toBe(120);

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify({ name: "Entry 119", content: "Content 119" })),
    );
    const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await bindings.DB.prepare(`
      INSERT INTO reference_sets (id, name, created_by) VALUES ('rs-large', 'Baseline', 'author');
      INSERT INTO reference_versions (id, reference_set_id, version_label, version_ordinal, grace_until, created_by)
        VALUES ('rv-large', 'rs-large', 'v1', 1, '2099-01-01T00:00:00.000Z', 'author');
      INSERT INTO reference_items (id, reference_version_id, kind, display_name, exact_hash, normalized_content_hash, name_hash, structure_hash)
        VALUES ('ri-large', 'rv-large', 'worldbook', 'Late match', ?, 'n', 'h', 's');
    `)
      .bind(fingerprint)
      .run();
    const limitedDB = {
      prepare(sql: string) {
        return {
          bind(...values: string[]) {
            if (values.length > 100) throw new Error("D1 parameter limit exceeded");
            return bindings.DB.prepare(sql).bind(...values);
          },
        };
      },
    } as unknown as D1Database;
    const candidates = [...Array.from({ length: 239 }, (_, index) => `nonmatching-${index}`), fingerprint];
    await expect(contentBaselineConflict({ DB: limitedDB, R2: bindings.R2 }, candidates)).resolves.toBe("Late match");
    const second = await uploadAndSubmit("Large conflicting book");
    expect(second.submitted.status).toBe(400);
    expect(await second.submitted.text()).toContain("Late match");
    const rejected = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM submissions WHERE project_id = ?")
      .bind(second.project.project.id)
      .first<{ count: number }>();
    expect(rejected?.count).toBe(0);
  });

  it("rate limits rapid metadata writes", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Rate" }) });
    const project = (await created.json()) as { project: { id: string } };
    const statements = Array.from({ length: 20 }, (_, index) =>
      bindings.DB.prepare(`INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        VALUES (?, 'project.patch', 'project', ?, 'author', '{}', ?)`).bind(
        `rate-${index}`,
        project.project.id,
        new Date().toISOString(),
      ),
    );
    await bindings.DB.batch(statements);
    const blocked = await request(`/${project.project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": "1" },
      body: JSON.stringify({ title: "too many" }),
    });
    expect(blocked.status).toBe(429);
  });

  it("soft deletes a project and hides it from the author", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Delete me" }) });
    const project = (await created.json()) as { project: { id: string } };
    const deleted = await request(`/${project.project.id}`, {
      method: "DELETE",
      headers: { "if-match": "1" },
    });
    expect(deleted.status).toBe(204);
    const row = await bindings.DB.prepare("SELECT deleted_at FROM projects WHERE id = ?")
      .bind(project.project.id)
      .first<{ deleted_at: string | null }>();
    expect(row?.deleted_at).toBeTruthy();
    expect((await request(`/${project.project.id}/draft`)).status).toBe(404);
  });

  it("updates metadata in place without changing the content revision", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "Metadata", versionLabel: "v1" }),
    });
    const project = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    await bindings.DB.prepare("UPDATE projects SET published_revision_id = ?, published_at = ? WHERE id = ?")
      .bind(project.workingRevisionId, now, project.project.id)
      .run();
    await bindings.DB.prepare("UPDATE project_revisions SET manifest_hash = ? WHERE id = ?")
      .bind("manifest-hash", project.workingRevisionId)
      .run();

    const patched = await request(`/${project.project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": "1" },
      body: JSON.stringify({ title: "Metadata v2", versionLabel: "v2", precautions: "注意" }),
    });
    expect(patched.status).toBe(200);
    await expect(patched.json()).resolves.toMatchObject({
      revisionId: project.workingRevisionId,
      rowVersion: 2,
    });
    const revision = await bindings.DB.prepare(
      "SELECT title, version_label, precautions, manifest_hash FROM project_revisions WHERE id = ?",
    )
      .bind(project.workingRevisionId)
      .first<Record<string, unknown>>();
    expect(revision).toMatchObject({
      title: "Metadata v2",
      version_label: "v2",
      precautions: "注意",
      manifest_hash: "manifest-hash",
    });
    const count = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM project_revisions WHERE project_id = ?")
      .bind(project.project.id)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
    const session: Session = {
      userId: "author",
      role: "member",
      sessionVersion: 1,
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const mine = await listAuthorProjects(bindings.DB, session);
    expect(mine.find((item) => item.project.id === project.project.id)).toMatchObject({
      project: { publishedRevisionId: project.workingRevisionId },
      precautions: "注意",
      authorNote: null,
    });

    const blocked = await request(`/${project.project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": "2" },
      body: JSON.stringify({ title: "bad\u0000title" }),
    });
    expect(blocked.status).toBe(400);
  });

  it("keeps published revision metadata immutable while editing a newer draft", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "Published title", versionLabel: "v1" }),
    });
    const first = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    await bindings.DB.prepare("UPDATE projects SET published_revision_id = ?, published_at = ? WHERE id = ?")
      .bind(first.workingRevisionId, now, first.project.id)
      .run();
    const before = await bindings.DB.prepare("SELECT updated_at FROM projects WHERE id = ?")
      .bind(first.project.id)
      .first<{ updated_at: string }>();

    const next = await request(`/${first.project.id}/revisions`, {
      method: "POST",
      headers: { "if-match": "1" },
      body: JSON.stringify({ title: "Draft title" }),
    });
    expect(next.status).toBe(201);
    const draft = (await next.json()) as { revisionId: string; rowVersion: number };

    const patched = await request(`/${first.project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": String(draft.rowVersion) },
      body: JSON.stringify({ title: "Draft title v2", versionLabel: "v2", precautions: "draft only" }),
    });
    expect(patched.status).toBe(200);

    const rows = await bindings.DB.prepare(
      "SELECT id, title, version_label, precautions FROM project_revisions WHERE project_id = ? ORDER BY revision_no",
    )
      .bind(first.project.id)
      .all<{ id: string; title: string; version_label: string; precautions: string | null }>();
    expect(rows.results).toEqual([
      { id: first.workingRevisionId, title: "Published title", version_label: "v1", precautions: null },
      { id: draft.revisionId, title: "Draft title v2", version_label: "v2", precautions: "draft only" },
    ]);
    const projectRow = await bindings.DB.prepare(
      "SELECT title, version_label, precautions, updated_at FROM projects WHERE id = ?",
    )
      .bind(first.project.id)
      .first<Record<string, unknown>>();
    expect(projectRow).toEqual({
      title: "Published title",
      version_label: "v1",
      precautions: null,
      updated_at: before?.updated_at,
    });
  });

  it("records a missing client gate as human review instead of rejecting the submit", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "Missing gate", projectType: "角色" }),
    });
    const project = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    const upload = await request(`/${project.project.id}/revisions/${project.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: validWorldbook,
      headers: { "content-type": "application/json", "content-length": String(validWorldbookBytes), "if-match": "1" },
    });
    const uploaded = (await upload.json()) as { rowVersion: number };
    const submitted = await request(`/${project.project.id}/revisions/${project.workingRevisionId}/submit`, {
      method: "POST",
      headers: { "if-match": String(uploaded.rowVersion) },
      body: JSON.stringify({}),
    });
    expect(submitted.status).toBe(201);
    const row = await bindings.DB.prepare(
      "SELECT status, client_gate, check_status FROM submissions WHERE project_id = ?",
    )
      .bind(project.project.id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({ status: "pending", client_gate: "missing", check_status: "needs_human" });
  });

  it("rejects Discord thread URLs outside the configured guild", async () => {
    const create = (discordThreadUrl: string) =>
      request("/", {
        method: "POST",
        body: JSON.stringify({ title: "Discord", discordThreadUrl }),
        headers: { "content-type": "application/json" },
      });

    for (const url of [
      "https://example.com/channels/123456789012345678/223456789012345678",
      "https://discord.gg/invite",
      "https://discord.com/channels/123456789012345678/2",
      "https://discord.com/channels/323456789012345678/223456789012345678",
    ]) {
      expect((await create(url)).status).toBe(400);
    }

    const valid = await create("https://www.discord.com/channels/123456789012345678/223456789012345678?foo=1");
    expect(valid.status).toBe(201);
    const body = (await valid.json()) as { project: { id: string } };
    const revision = await bindings.DB.prepare("SELECT discord_thread_url FROM project_revisions WHERE project_id = ?")
      .bind(body.project.id)
      .first<{ discord_thread_url: string }>();
    expect(revision?.discord_thread_url).toBe("https://discord.com/channels/123456789012345678/223456789012345678");
  });

  it("rejects invalid uploads and policy-invalid submissions", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "Validation", projectType: "角色" }),
    });
    const project = (await created.json()) as { project: { id: string }; workingRevisionId: string };
    let rowVersion = 1;
    const upload = async (kind: string, body: string, mime = "application/json") => {
      const response = await request(`/${project.project.id}/revisions/${project.workingRevisionId}/files/${kind}`, {
        method: "PUT",
        body,
        headers: {
          "content-type": mime,
          "content-length": String(new TextEncoder().encode(body).byteLength),
          "if-match": String(rowVersion),
        },
      });
      if (response.ok) {
        const result = uploadResponseSchema.parse(await response.clone().json());
        rowVersion = result.rowVersion;
      }
      return response;
    };

    expect((await upload("worldbook", "not json")).status).toBe(400);
    expect((await upload("worldbook", JSON.stringify({ entries: [] }))).status).toBe(400);
    expect((await upload("regex", validWorldbook)).status).toBe(400);

    const emptySubmit = await request(`/${project.project.id}/revisions/${project.workingRevisionId}/submit`, {
      method: "POST",
      headers: { "if-match": String(rowVersion) },
      body: JSON.stringify({ gate: "pass" }),
    });
    expect(emptySubmit.status).toBe(400);
    const none = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM submissions WHERE project_id = ?")
      .bind(project.project.id)
      .first<{ count: number }>();
    expect(none?.count).toBe(0);

    const regex = JSON.stringify({ scriptName: "Test", findRegex: "/a/g", replaceString: "b" });
    expect((await upload("regex", regex)).status).toBe(200);
    const roleWithoutWorldbook = await request(`/${project.project.id}/revisions/${project.workingRevisionId}/submit`, {
      method: "POST",
      headers: { "if-match": String(rowVersion) },
      body: JSON.stringify({ gate: "warn" }),
    });
    expect(roleWithoutWorldbook.status).toBe(400);

    expect((await upload("worldbook", validWorldbook)).status).toBe(200);
    const validSubmit = await request(`/${project.project.id}/revisions/${project.workingRevisionId}/submit`, {
      method: "POST",
      headers: { "if-match": String(rowVersion) },
      body: JSON.stringify({ gate: "warn" }),
    });
    expect(validSubmit.status).toBe(201);
  });
});
