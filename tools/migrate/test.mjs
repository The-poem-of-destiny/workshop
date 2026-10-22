#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extract, stableStringify, transform, verify } from "./lib.mjs";
import { buildManifest } from "./r2-copy.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const asset = (project_id, kind, r2_key, value) => {
  const bytes = Buffer.from(value);
  return {
    project_id,
    kind,
    r2_key,
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    mime: "application/json",
    content_base64: bytes.toString("base64"),
  };
};

const dir = await mkdtemp(path.join(os.tmpdir(), "workshop-migration-"));
try {
  const source = path.join(dir, "source");
  await mkdir(source);
  await writeFile(
    path.join(source, "users.json"),
    JSON.stringify([
      {
        id: "author",
        username: "author",
        global_name: "Author",
        is_admin: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: "former-admin",
        username: "admin",
        is_admin: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    ]),
  );
  await writeFile(
    path.join(source, "projects.json"),
    JSON.stringify([
      {
        id: "public",
        name: "Published",
        author_id: "author",
        status: "approved",
        is_published: 1,
        visibility: 1,
        tags: '["worldbook"]',
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: "draft",
        name: "Draft",
        author_id: "author",
        status: "approved",
        is_published: 0,
        visibility: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: "private",
        name: "Private",
        author_id: "author",
        status: "approved",
        is_published: 1,
        visibility: 0,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: "pending",
        name: "Pending",
        author_id: "author",
        status: "pending",
        is_published: 1,
        visibility: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: "malformed",
        name: "Malformed",
        author_id: "author",
        status: "approved",
        is_published: 1,
        visibility: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    ]),
  );
  const worldbook = '{"entries":{"first":{"uid":"entry-1","comment":"世界","content":"猫"}}}';
  const regex = '[{"id":"regex-1","scriptName":"Script","findRegex":"a","replaceString":"替换"}]';
  const broken = asset("malformed", "worldbook", "projects/malformed/worldbook.json", "not json");
  await writeFile(
    path.join(source, "assets.json"),
    JSON.stringify([
      asset("public", "worldbook", "projects/public/worldbook.json", worldbook),
      asset("public", "regex", "projects/public/regex-public.json", regex),
      asset("public", "cover", "projects/public/cover.png", "cover-bytes"),
      broken,
    ]),
  );

  const first = transform(await extract(source));
  const second = transform(await extract(source));
  assert.equal(stableStringify(first), stableStringify(second), "unchanged explicit export is deterministic");
  assert.deepEqual(
    first.tables.projects.map((project) => project.id),
    ["public"],
    "only public published releases survive",
  );
  assert.deepEqual(
    first.tables.users.map((user) => [user.id, user.role]),
    [["author", "member"]],
    "authors retain identity without legacy privilege",
  );
  assert.equal(first.tables.project_revisions[0].worldbook_count, 1);
  assert.equal(first.tables.project_revisions[0].regex_count, 1);
  assert.deepEqual(
    first.tables.revision_entry_index.map((entry) => [entry.kind, entry.entry_key, entry.content_length]).sort(),
    [
      ["regex", "id:regex-1", 2],
      ["worldbook", "object:first", 1],
    ],
  );
  assert.ok(
    first.meta.skipped.some(
      (item) => item.project_id === "malformed" && item.reason.startsWith("worldbook_invalid_worldbook_content:"),
    ),
  );
  assert.equal(verify(first).ok, true, JSON.stringify(verify(first).mismatches));

  const cover = first.tables.assets.find((row) => row.kind === "cover");
  assert.ok(cover.r2_key.startsWith("covers/"), "imported covers must be reachable through the public asset route");

  const missingKeySource = await extract(source);
  missingKeySource.tables.assets.find((row) => row.project_id === "public" && row.kind === "worldbook").r2_key = "";
  const missingKeyTarget = transform(missingKeySource);
  assert.equal(
    missingKeyTarget.tables.projects.some((row) => row.id === "public"),
    false,
    "a missing worldbook key must reject the release rather than publish only its regex",
  );
  assert.ok(
    missingKeyTarget.meta.skipped.some(
      (row) => row.project_id === "public" && row.reason === "asset_worldbook_missing_r2_key",
    ),
  );

  const sharedSource = await extract(source);
  const sharedProject = { ...sharedSource.tables.projects.find((row) => row.id === "public"), id: "shared" };
  sharedSource.tables.projects.push(sharedProject);
  sharedSource.tables.assets.push({
    ...sharedSource.tables.assets.find((row) => row.project_id === "public" && row.kind === "worldbook"),
    project_id: "shared",
  });
  const sharedTarget = transform(sharedSource);
  assert.equal(verify(sharedTarget).ok, true);
  const sharedManifest = buildManifest(sharedTarget);
  assert.equal(
    sharedManifest.objects.filter((row) => row.targetKey === "projects/public/worldbook.json").length,
    1,
    "shared immutable objects are copied once, not rejected as duplicate destinations",
  );
  const conflict = structuredClone(sharedTarget);
  conflict.tables.assets.find((row) => row.project_id === "shared").sha256 = "f".repeat(64);
  assert.throws(() => buildManifest(conflict), /conflicting shared object/);

  const alteredHash = structuredClone(first);
  alteredHash.tables.assets[0].sha256 = "0".repeat(64);
  assert.equal(verify(alteredHash).ok, false, "asset SHA changes are rejected");
  const alteredIndex = structuredClone(first);
  alteredIndex.tables.revision_entry_index.pop();
  assert.equal(verify(alteredIndex).ok, false, "incomplete persisted entry indexes are rejected");

  console.log("migration tests passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
