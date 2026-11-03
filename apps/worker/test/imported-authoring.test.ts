import { env, SELF } from "cloudflare:test";
import type { Session } from "@workshop/contracts";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DataEnv } from "../src/data/env";
import { upsertStreamedAsset } from "../src/storage/authoring-assets";
import { patchProject } from "../src/storage/authoring-versions";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const now = "2026-10-21T00:00:00.000Z";
const token = "imported-author-token";
const session: Session = {
  userId: "imported-author",
  role: "member",
  sessionVersion: 1,
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const original = JSON.stringify({ entries: [{ uid: 1, name: "Original", content: "Published text" }] });
const replacement = JSON.stringify({ entries: [{ uid: 1, name: "Changed", content: "Changed text" }] });

async function hash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return SELF.fetch(`https://workshop.test/api/v1/projects${path}`, { ...init, headers });
}
function metadata(method: string, version: number, value: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json", "if-match": String(version) },
    body: JSON.stringify(value),
  };
}
function upload(text: string, version: number): RequestInit {
  return {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(text).byteLength),
      "if-match": String(version),
    },
    body: text,
  };
}

async function seedImported(workingNo = 7, publishedNo = workingNo) {
  const created = await request("", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Working" }),
  });
  const { project, workingVersionId } = (await created.json()) as { project: { id: string }; workingVersionId: string };
  const publishedId = workingNo === publishedNo ? workingVersionId : crypto.randomUUID();
  await bindings.DB.prepare(
    "UPDATE project_versions SET version_no = ?, description = NULL, author_note = NULL, project_type = NULL, extension_type = NULL, version_label = NULL WHERE id = ?",
  )
    .bind(workingNo, workingVersionId)
    .run();
  if (publishedId !== workingVersionId) {
    await bindings.DB.prepare(`INSERT INTO project_versions (id, project_id, version_no, title, description, author_note, tags, created_by, created_at)
      VALUES (?, ?, ?, 'Published', 'Published description', 'Published note', '[]', ?, ?)`)
      .bind(publishedId, project.id, publishedNo, session.userId, now)
      .run();
  }
  await bindings.DB.prepare(
    "UPDATE projects SET published_version_id = ?, published_at = ?, visibility = 'public' WHERE id = ?",
  )
    .bind(publishedId, now, project.id)
    .run();
  const key = `imported/${project.id}/worldbook.json`;
  await bindings.R2.put(key, original, { httpMetadata: { contentType: "application/json" } });
  await bindings.DB.prepare(
    "INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime) VALUES (?, ?, ?, 'worldbook', ?, ?, ?, 'application/json')",
  )
    .bind(
      crypto.randomUUID(),
      project.id,
      publishedId,
      key,
      await hash(original),
      new TextEncoder().encode(original).byteLength,
    )
    .run();
  return { projectId: project.id, workingId: workingVersionId, publishedId, key };
}

beforeAll(async () => {
  await applySchema(bindings.DB);
  bindings.DISCORD_ALLOWED_GUILD_IDS = "123456789012345678";
});
beforeEach(async () => {
  await bindings.DB.exec(
    "DELETE FROM audit_events; DELETE FROM submissions; DELETE FROM assets; DELETE FROM project_versions; DELETE FROM projects; DELETE FROM sessions; DELETE FROM users;",
  );
  await bindings.DB.prepare(
    "INSERT INTO users (id, username, role, created_at, updated_at) VALUES (?, 'Author', 'member', ?, ?)",
  )
    .bind(session.userId, now, now)
    .run();
  await bindings.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await hash(token), session.userId, session.expiresAt)
    .run();
});

describe("imported publication authoring", () => {
  it("freezes published content and metadata without review history", async () => {
    const { projectId, publishedId, key } = await seedImported();
    const version = await bindings.DB.prepare("SELECT * FROM project_versions WHERE id = ?").bind(publishedId).first();
    const asset = await bindings.DB.prepare("SELECT * FROM assets WHERE version_id = ?").bind(publishedId).first();
    expect((await request(`/${projectId}`, metadata("PATCH", 1, { title: "Changed" }))).status).toBe(409);
    await expect(patchProject(bindings.DB, session, projectId, 1, { authorNote: "Changed" })).resolves.toBeNull();
    expect(
      (await request(`/${projectId}/versions/${publishedId}/files/worldbook`, upload(replacement, 1))).status,
    ).toBe(404);
    expect(
      (
        await request(`/${projectId}/versions/${publishedId}/entries/worldbook/uid%3A1`, {
          method: "DELETE",
          headers: { "if-match": "1" },
        })
      ).status,
    ).toBe(409);
    const bytes = new TextEncoder().encode(replacement);
    await expect(
      upsertStreamedAsset(
        bindings.DB,
        projectId,
        publishedId,
        1,
        "worldbook",
        await hash(replacement),
        bytes.byteLength,
        "application/json",
        1,
        async (target, options) => {
          await bindings.R2.put(target, bytes, options);
        },
      ),
    ).resolves.toBeNull();
    const created = await request(`/${projectId}/versions`, metadata("POST", 1, { title: "Successor" }));
    expect(created.status).toBe(201);
    const successor = (await created.json()) as { versionId: string; rowVersion: number };
    expect(successor.rowVersion).toBe(2);
    expect((await request(`/${projectId}`, metadata("PATCH", 2, { authorNote: "Working note" }))).status).toBe(200);
    expect(
      (await request(`/${projectId}/versions/${successor.versionId}/files/worldbook`, upload(replacement, 3))).status,
    ).toBe(200);
    expect(await bindings.DB.prepare("SELECT * FROM project_versions WHERE id = ?").bind(publishedId).first()).toEqual(
      version,
    );
    expect(await bindings.DB.prepare("SELECT * FROM assets WHERE version_id = ?").bind(publishedId).first()).toEqual(
      asset,
    );
    await expect((await bindings.R2.get(key))?.text()).resolves.toBe(original);
  });

  it("allocates above all historical versions with one concurrent winner", async () => {
    const { projectId, publishedId } = await seedImported(3, 9);
    const responses = await Promise.all(
      ["First", "Second"].map((title) => request(`/${projectId}/versions`, metadata("POST", 1, { title }))),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 412]);
    const successor = (await responses.find((response) => response.status === 201)!.json()) as { versionId: string };
    const versions = await bindings.DB.prepare(
      "SELECT version_no FROM project_versions WHERE project_id = ? ORDER BY version_no",
    )
      .bind(projectId)
      .all<{ version_no: number }>();
    expect(versions.results.map((row) => row.version_no)).toEqual([3, 9, 10]);
    expect(
      await bindings.DB.prepare(
        "SELECT working_version_id, published_version_id, row_version FROM projects WHERE id = ?",
      )
        .bind(projectId)
        .first(),
    ).toEqual({ working_version_id: successor.versionId, published_version_id: publishedId, row_version: 2 });
  });

  it("preserves null working metadata through unrelated edits and successor copies", async () => {
    const { projectId } = await seedImported(3, 9);
    const expected = {
      description: null,
      authorNote: null,
      projectType: null,
      extensionType: null,
      versionLabel: null,
    };
    await expect((await request(`/${projectId}/draft`)).json()).resolves.toMatchObject({ project: expected });
    expect((await request(`/${projectId}`, metadata("PATCH", 1, { title: "Renamed" }))).status).toBe(200);
    const created = await request(`/${projectId}/versions`, metadata("POST", 2, { title: "Next" }));
    expect(created.status).toBe(201);
    await expect((await request(`/${projectId}/draft`)).json()).resolves.toMatchObject({
      project: { ...expected, title: "Next" },
    });
  });
});
