import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = name => JSON.parse(readFileSync(path.join(root, "tests", "fixtures", "legacy", name), "utf8"));

function publicSummary(project) {
  return {
    id: project.id,
    title: project.name,
    description: project.description ?? null,
    author: { id: project.authorId, name: project.authorName, avatarUrl: project.authorAvatar ?? null },
    projectType: project.projectType ?? null,
    extensionType: project.extensionType ?? null,
    tags: Array.isArray(project.tags) ? project.tags : [],
    versionLabel: project.versionLabel ?? null,
    entries: {
      worldbook: project.worldbookEntriesPreview?.length ?? 0,
      regex: project.regexEntriesPreview?.length ?? 0,
    },
    counts: {
      downloads: project.downloadsCount ?? 0,
      likes: project.likesCount ?? 0,
      subscriptions: project.subscribesCount ?? 0,
    },
    coverUrl: project.coverImage ?? null,
    publishedAt: project.latestApprovedAt ?? null,
    updatedAt: project.updatedAt,
  };
}

function entryIndex(preview) {
  return preview.map(entry => ({
    entryKey: entry.entryKey,
    name: entry.comment ?? entry.entryKey,
    contentLength: Array.from(String(entry.content ?? "")).length,
    contentHash: "sha256-of-content",
  }));
}

const lists = ["projects-default.json", "projects-downloads.json", "projects-search.json", "projects-type-core.json", "projects-updated.json"];
for (const name of lists) {
  const body = fixture(name);
  assert.equal(body.success, true, name);
  assert.ok(Array.isArray(body.projects), `${name} projects`);
  const ids = body.projects.map(project => project.id);
  assert.equal(new Set(ids).size, ids.length, `${name} unique ids`);
  for (const project of body.projects) {
    const summary = publicSummary(project);
    assert.equal(summary.title, project.name);
    assert.equal(typeof summary.author.name, "string");
    assert.equal("downloadUrl" in summary, false, "public summary drops legacy download URL");
    assert.equal("authorId" in summary, false, "public summary nests author id");
    assert.equal("rootProjectId" in summary, false, "public summary drops root pointer");
    assert.equal(Array.isArray(summary.tags), true);
  }
}

const search = fixture("projects-search.json");
assert.ok(search.projects.some(project => project.name.includes("电子迷宫")));
const core = fixture("projects-type-core.json");
assert.ok(core.projects.every(project => project.projectType === "系统核心"));
assert.equal(core.projects.length, 2);
assert.equal(search.page, 0);

const detail = fixture("project-1-detail.json");
assert.equal(detail.success, true);
assert.ok(detail.project.id);
const index = entryIndex(detail.worldbookEntriesPreview);
assert.ok(index.length > 0);
for (const entry of index) {
  assert.equal("content" in entry, false, "entry index must not expose installable content");
  assert.ok(entry.contentLength > 0);
  assert.match(entry.contentHash, /^sha256-/);
}

const install = fixture("project-1-install-info.json");
assert.equal(typeof install.error, "string", "legacy anonymous install fixture is denied");
assert.match(install.error, /登录/);

const references = fixture("character-references.json");
assert.equal(references.success, true);
assert.ok(Array.isArray(references.references));

const page = fixture("projects-page-1.json");
assert.equal(page.page, 1);
assert.ok(Array.isArray(page.projects));

console.log("legacy public contract tests passed");
