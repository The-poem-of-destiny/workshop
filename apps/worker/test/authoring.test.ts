import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authoringRoutes } from "../src/http/routes/authoring";
import { listAuthorProjects, upsertAsset } from "../src/storage/authoring";
import type { Session } from "@workshop/contracts";
import type { Env } from "../src/env";
import { applySchema } from "./support/schema";

const bindings = env as unknown as Env;
const now = "2026-10-21T00:00:00.000Z";
const validWorldbook = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "Text" }] });
const validWorldbookBytes = new TextEncoder().encode(validWorldbook).byteLength;

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function seedUser(id: string, role: "member" | "owner" = "member", token = `${id}-token`) {
  await bindings.DB.prepare("INSERT INTO users (id, username, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, id, role, now, now).run();
  await bindings.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(await tokenHash(token), id, "2099-01-01T00:00:00.000Z").run();
}

async function request(path: string, init: RequestInit = {}, token = "author-token") {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return authoringRoutes.request(path, { ...init, headers }, bindings);
}

beforeAll(async () => {
  await applySchema(bindings.DB);
  bindings.DISCORD_ALLOWED_GUILD_IDS = "123456789012345678";
});

beforeEach(async () => {
  await bindings.DB.exec(`
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
  it("creates projects and enforces the row-version CAS", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "New project", description: "draft", tags: ["tag"] }),
      headers: { "content-type": "application/json" },
    });
    expect(created.status).toBe(201);
    const body = await created.json() as { project: { id: string; visibility: string }; rowVersion: number; workingRevisionId: string };
    expect(body.project.visibility).toBe("private");
    expect(body.rowVersion).toBe(1);
    expect(body.workingRevisionId).toBeTruthy();

    const mismatch = await request(`/${body.project.id}`, {
      method: "PATCH", headers: { "content-type": "application/json", "if-match": "99" },
      body: JSON.stringify({ title: "stale" }),
    });
    expect(mismatch.status).toBe(412);
  });

  it("hides projects from non-authors and permits owners", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Private" }) });
    const { project, workingRevisionId } = await created.json() as {
      project: { id: string };
      workingRevisionId: string;
    };
    const forbidden = await request(`/${project.id}`, { method: "PATCH", headers: { "if-match": "1" }, body: JSON.stringify({ title: "Nope" }) }, "other-token");
    expect(forbidden.status).toBe(404);
    expect((await request(`/${project.id}/draft`, {}, "other-token")).status).toBe(404);
    const draft = await request(`/${project.id}/draft`);
    expect(draft.status).toBe(200);
    await expect(draft.json()).resolves.toMatchObject({
      project: { id: project.id },
      rowVersion: 1,
      workingRevisionId,
    });
    const allowed = await request(`/${project.id}`, { method: "PATCH", headers: { "if-match": "1" }, body: JSON.stringify({ title: "owner edit" }) }, "owner-token");
    expect(allowed.status).toBe(200);
  });

  it("keeps revision numbers immutable and uploads hashed assets", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Versions" }) });
    const first = await created.json() as { project: { id: string }; workingRevisionId: string };
    const revision = await request(`/${first.project.id}/revisions`, {
      method: "POST",
      headers: { "if-match": "1" },
      body: JSON.stringify({ title: "Second" }),
    });
    expect(revision.status).toBe(201);
    const second = await revision.json() as { revisionId: string };
    const upload = await request(`/${first.project.id}/revisions/${second.revisionId}/files/worldbook`, {
      method: "PUT",
      body: validWorldbook,
      headers: { "content-type": "application/json", "content-length": String(validWorldbookBytes) },
    });
    expect(upload.status).toBe(200);
    await expect(upload.json()).resolves.toMatchObject({
      kind: "worldbook",
      bytes: validWorldbookBytes,
      mime: "application/json",
    });
    const listed = await bindings.R2.list({ prefix: `projects/${first.project.id}/revisions/${second.revisionId}/worldbook-` });
    expect(listed.objects).toHaveLength(1);
    const object = await bindings.R2.get(listed.objects[0]!.key);
    await expect(object?.text()).resolves.toBe(validWorldbook);
    const rows = await bindings.DB.prepare("SELECT revision_no FROM project_revisions WHERE project_id = ? ORDER BY revision_no")
      .bind(first.project.id).all<{ revision_no: number }>();
    expect(rows.results.map(row => row.revision_no)).toEqual([1, 2]);
  });

  it("deletes one entry into a new revision without touching the old asset", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Entries" }) });
    const first = await created.json() as { project: { id: string }; workingRevisionId: string };
    const twoEntries = JSON.stringify({ entries: [
      { uid: 1, name: "One", content: "a" },
      { uid: 2, name: "Two", content: "b" },
    ] });
    const bytes = new TextEncoder().encode(twoEntries).byteLength;
    await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: twoEntries,
      headers: { "content-type": "application/json", "content-length": String(bytes) },
    });
    const deleted = await request(
      `/${first.project.id}/revisions/${first.workingRevisionId}/entries/worldbook/${encodeURIComponent("uid:1")}`,
      { method: "DELETE", headers: { "if-match": "1" } },
    );
    expect(deleted.status).toBe(200);
    const result = await deleted.json() as { rowVersion: number; revisionId: string; entryCount: number };
    expect(result.rowVersion).toBe(2);
    expect(result.entryCount).toBe(1);
    expect(result.revisionId).not.toBe(first.workingRevisionId);
    const draft = await request(`/${first.project.id}/draft`);
    await expect(draft.json()).resolves.toMatchObject({ workingRevisionId: result.revisionId, rowVersion: 2 });
    const asset = await bindings.DB.prepare("SELECT r2_key FROM assets WHERE revision_id = ? AND kind = 'worldbook'")
      .bind(result.revisionId).first<{ r2_key: string }>();
    const counts = await bindings.DB.prepare("SELECT worldbook_count FROM project_revisions WHERE id = ?")
      .bind(result.revisionId).first<{ worldbook_count: number }>();
    expect(counts?.worldbook_count).toBe(1);
    const text = await (await bindings.R2.get(asset!.r2_key))?.text();
    expect(JSON.parse(text ?? "{}").entries).toEqual([{ uid: 2, name: "Two", content: "b" }]);
    const oldAsset = await bindings.DB.prepare("SELECT r2_key FROM assets WHERE revision_id = ? AND kind = 'worldbook'")
      .bind(first.workingRevisionId).first<{ r2_key: string }>();
    expect(oldAsset?.r2_key).not.toBe(asset?.r2_key);
  });

  it("supersedes pending submissions and rejects unsupported/oversized uploads", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Submit" }) });
    const first = await created.json() as { project: { id: string }; workingRevisionId: string };
    const upload = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: validWorldbook,
      headers: { "content-type": "application/json", "content-length": String(validWorldbookBytes) },
    });
    expect(upload.status).toBe(200);
    const submit = async () => request(`/${first.project.id}/revisions/${first.workingRevisionId}/submit`, {
      method: "POST", body: JSON.stringify({ gate: "warn", checkerRevision: "c1" }),
    });
    expect((await submit()).status).toBe(201);
    expect((await submit()).status).toBe(201);
    const statuses = await bindings.DB.prepare("SELECT status FROM submissions WHERE project_id = ? ORDER BY submitted_at")
      .bind(first.project.id).all<{ status: string }>();
    expect(statuses.results.map(row => row.status)).toEqual(["superseded", "checking"]);
    const forbidden = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/nope`, { method: "PUT", body: "x" });
    expect(forbidden.status).toBe(400);

    // A submitted revision is frozen: no post-submit byte replacement.
    const frozen = await request(`/${first.project.id}/revisions/${first.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: validWorldbook,
      headers: { "content-type": "application/json", "content-length": String(validWorldbookBytes) },
    });
    expect(frozen.status).toBe(404);

    // Storage-level guard closes the check-then-act window after submit.
    const raced = await upsertAsset(
      bindings.DB,
      bindings.R2,
      first.project.id,
      first.workingRevisionId,
      "worldbook",
      new TextEncoder().encode(validWorldbook).buffer,
      "application/json",
      1,
    );
    expect(raced).toBeNull();
    const manifest = await bindings.DB.prepare("SELECT manifest_hash FROM project_revisions WHERE id = ?")
      .bind(first.workingRevisionId).first<{ manifest_hash: string | null }>();
    expect(manifest?.manifest_hash).toMatch(/^[0-9a-f]{64}$/);

    // A fresh working revision can still be uploaded; size is rejected before buffering.
    const next = await request(`/${first.project.id}/revisions`, {
      method: "POST",
      headers: { "if-match": "1" },
      body: JSON.stringify({ title: "Third" }),
    });
    expect(next.status).toBe(201);
    const third = await next.json() as { revisionId: string };
    const oversized = await request(`/${first.project.id}/revisions/${third.revisionId}/files/cover`, {
      method: "PUT",
      body: "x",
      headers: { "content-type": "image/png", "content-length": String(10 * 1024 * 1024 + 1) },
    });
    expect(oversized.status).toBe(413);
  });

  it("rejects a submission containing an entry identical to an official baseline item", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Baseline" }) });
    const project = await created.json() as { project: { id: string }; workingRevisionId: string };
    await request(`/${project.project.id}/revisions/${project.workingRevisionId}/files/worldbook`, {
      method: "PUT", body: validWorldbook,
      headers: { "content-type": "application/json", "content-length": String(validWorldbookBytes) },
    });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify({ name: "Entry", content: "Text" })),
    );
    const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    await bindings.DB.prepare(`
      INSERT INTO reference_sets (id, name, created_by) VALUES ('rs1', 'Baseline', 'author');
      INSERT INTO reference_versions (id, reference_set_id, version_label, version_ordinal, grace_until, created_by)
        VALUES ('rv1', 'rs1', 'v1', 1, '2099-01-01T00:00:00.000Z', 'author');
      INSERT INTO reference_items (id, reference_version_id, kind, display_name, exact_hash, normalized_content_hash, name_hash, structure_hash)
        VALUES ('ri1', 'rv1', 'worldbook', 'Official', ?, 'n', 'h', 's');
    `).bind(fingerprint).run();
    const submitted = await request(`/${project.project.id}/revisions/${project.workingRevisionId}/submit`, {
      method: "POST", body: JSON.stringify({ gate: "pass" }),
    });
    expect(submitted.status).toBe(400);
    const count = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM submissions WHERE project_id = ?")
      .bind(project.project.id).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("rate limits rapid metadata writes", async () => {
    const created = await request("/", { method: "POST", body: JSON.stringify({ title: "Rate" }) });
    const project = await created.json() as { project: { id: string } };
    const statements = Array.from({ length: 20 }, (_, index) =>
      bindings.DB.prepare(`INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        VALUES (?, 'project.patch', 'project', ?, 'author', '{}', ?)`)
        .bind(`rate-${index}`, project.project.id, new Date().toISOString()),
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
    const project = await created.json() as { project: { id: string } };
    const deleted = await request(`/${project.project.id}`, {
      method: "DELETE",
      headers: { "if-match": "1" },
    });
    expect(deleted.status).toBe(204);
    const row = await bindings.DB.prepare("SELECT deleted_at FROM projects WHERE id = ?")
      .bind(project.project.id).first<{ deleted_at: string | null }>();
    expect(row?.deleted_at).toBeTruthy();
    expect((await request(`/${project.project.id}/draft`)).status).toBe(404);
  });

  it("updates metadata in place without changing the content revision", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "Metadata", versionLabel: "v1" }),
    });
    const project = await created.json() as { project: { id: string }; workingRevisionId: string };
    await bindings.DB.prepare("UPDATE projects SET published_revision_id = ?, published_at = ? WHERE id = ?")
      .bind(project.workingRevisionId, now, project.project.id).run();
    await bindings.DB.prepare("UPDATE project_revisions SET manifest_hash = ? WHERE id = ?")
      .bind("manifest-hash", project.workingRevisionId).run();

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
    ).bind(project.workingRevisionId).first<Record<string, unknown>>();
    expect(revision).toMatchObject({
      title: "Metadata v2",
      version_label: "v2",
      precautions: "注意",
      manifest_hash: "manifest-hash",
    });
    const count = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM project_revisions WHERE project_id = ?")
      .bind(project.project.id).first<{ count: number }>();
    expect(count?.count).toBe(1);
    const session: Session = {
      userId: "author", role: "member", sessionVersion: 1, expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const mine = await listAuthorProjects(bindings.DB, session);
    expect(mine.find(item => item.project.id === project.project.id)).toMatchObject({
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

  it("records a missing client gate as human review instead of rejecting the submit", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "Missing gate", projectType: "角色" }),
    });
    const project = await created.json() as { project: { id: string }; workingRevisionId: string };
    await request(`/${project.project.id}/revisions/${project.workingRevisionId}/files/worldbook`, {
      method: "PUT",
      body: validWorldbook,
      headers: { "content-type": "application/json", "content-length": String(validWorldbookBytes) },
    });
    const submitted = await request(
      `/${project.project.id}/revisions/${project.workingRevisionId}/submit`,
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(submitted.status).toBe(201);
    const row = await bindings.DB.prepare(
      "SELECT status, client_gate, check_status FROM submissions WHERE project_id = ?",
    ).bind(project.project.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ status: "pending", client_gate: "missing", check_status: "needs_human" });
  });

  it("rejects Discord thread URLs outside the configured guild", async () => {
    const create = (discordThreadUrl: string) => request("/", {
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

    const valid = await create(
      "https://www.discord.com/channels/123456789012345678/223456789012345678?foo=1",
    );
    expect(valid.status).toBe(201);
    const body = await valid.json() as { project: { id: string } };
    const revision = await bindings.DB.prepare(
      "SELECT discord_thread_url FROM project_revisions WHERE project_id = ?",
    ).bind(body.project.id).first<{ discord_thread_url: string }>();
    expect(revision?.discord_thread_url).toBe(
      "https://discord.com/channels/123456789012345678/223456789012345678",
    );
  });

  it("rejects invalid uploads and policy-invalid submissions", async () => {
    const created = await request("/", {
      method: "POST",
      body: JSON.stringify({ title: "Validation", projectType: "角色" }),
    });
    const project = await created.json() as { project: { id: string }; workingRevisionId: string };
    const upload = (kind: string, body: string, mime = "application/json") =>
      request(`/${project.project.id}/revisions/${project.workingRevisionId}/files/${kind}`, {
        method: "PUT",
        body,
        headers: { "content-type": mime, "content-length": String(new TextEncoder().encode(body).byteLength) },
      });

    expect((await upload("worldbook", "not json")).status).toBe(400);
    expect((await upload("worldbook", JSON.stringify({ entries: [] }))).status).toBe(400);
    expect((await upload("regex", validWorldbook)).status).toBe(400);

    const emptySubmit = await request(
      `/${project.project.id}/revisions/${project.workingRevisionId}/submit`,
      { method: "POST", body: JSON.stringify({ gate: "pass" }) },
    );
    expect(emptySubmit.status).toBe(400);
    const none = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM submissions WHERE project_id = ?")
      .bind(project.project.id).first<{ count: number }>();
    expect(none?.count).toBe(0);

    const regex = JSON.stringify({ scriptName: "Test", findRegex: "/a/g", replaceString: "b" });
    expect((await upload("regex", regex)).status).toBe(200);
    const roleWithoutWorldbook = await request(
      `/${project.project.id}/revisions/${project.workingRevisionId}/submit`,
      { method: "POST", body: JSON.stringify({ gate: "warn" }) },
    );
    expect(roleWithoutWorldbook.status).toBe(400);

    expect((await upload("worldbook", validWorldbook)).status).toBe(200);
    const validSubmit = await request(
      `/${project.project.id}/revisions/${project.workingRevisionId}/submit`,
      { method: "POST", body: JSON.stringify({ gate: "warn" }) },
    );
    expect(validSubmit.status).toBe(201);
  });
});
