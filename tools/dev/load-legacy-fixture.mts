/**
 * One-shot loader: copies the real published projects from the legacy backup
 * into the local preview state, so the preview shows real catalogue data
 * instead of hand-written samples.
 *
 * Configure paths, reviewed taxonomy input and the Python executable in
 * tools/dev/load-legacy-fixture.local.json using the example. Stop the preview
 * before running: node --experimental-strip-types tools/dev/load-legacy-fixture.mts
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { extractProjectEntries } from "../../packages/domain/src/project-content.ts";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const configPath = resolve(root, process.argv[2] ?? "tools/dev/load-legacy-fixture.local.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
function configuredPath(key: string): string {
  const value = config[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing path ${key} in ${configPath}`);
  const path = resolve(root, value);
  if (!fs.existsSync(path)) throw new Error(`Configured ${key} does not exist: ${path}`);
  return path;
}
const legacyDbPath = configuredPath("legacyDbPath");
const r2Source = configuredPath("r2Source");
const d1Path = configuredPath("d1Path");
const r2MetaPath = configuredPath("r2MetaPath");
const r2BlobDir = configuredPath("r2BlobDir");
const taxonomyReviewPath = configuredPath("taxonomyReviewPath");
const pythonPath = configuredPath("pythonPath");
function positiveInteger(key: string): number {
  const value = config[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Expected positive integer ${key} in ${configPath}`);
  }
  return value;
}
const COVER_MAX_WIDTH = positiveInteger("coverMaxWidth");
const LIMIT = positiveInteger("projectLimit");

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Row shapes of the legacy database; the SQL below selects exactly these columns. */
type LegacyUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  role: string;
  created_at: string;
  updated_at: string;
};
type LegacyProject = {
  id: string;
  author_id: string;
  description: string | null;
  published_revision_id: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};
type LegacyRevision = {
  id: string;
  title: string;
  description: string | null;
  manifest_hash: string | null;
  created_by: string;
  created_at: string;
  version_label: string | null;
  cover_position_x: number | null;
  cover_position_y: number | null;
  cover_zoom: number | null;
};
type LegacyAsset = { project_id: string; kind: string };
type IndexEntry = {
  kind: "worldbook" | "regex";
  entryKey: string;
  name: string;
  contentHash: string;
  contentLength: number;
};

function projectContentFile(projectId: string, kind: "worldbook" | "regex"): string {
  const prefix = kind === "worldbook" ? "project" : "regex";
  return join(r2Source, projectId, `${prefix}-${projectId}.json`);
}

/** Rebuild the entry index from the payloads exactly the way the Worker does. */
function buildEntryIndex(projectId: string, kinds: readonly ("worldbook" | "regex")[]): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const kind of kinds) {
    const file = projectContentFile(projectId, kind);
    if (!fs.existsSync(file)) continue;
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const ref of extractProjectEntries(raw, kind)) {
      const content =
        typeof ref.entry.content === "string"
          ? ref.entry.content
          : typeof ref.entry.replaceString === "string"
            ? ref.entry.replaceString
            : "";
      const candidates: unknown[] = [ref.entry.name, ref.entry.comment, ref.entry.scriptName];
      const name =
        candidates.find((value): value is string => typeof value === "string" && value.trim() !== "") ?? ref.entryKey;
      entries.push({
        kind,
        entryKey: ref.entryKey,
        name,
        contentHash: sha256(content),
        contentLength: Array.from(content).length,
      });
    }
  }
  return entries;
}

/**
 * Downscale the published cover so a hundred projects stay cheap to read.
 * The container is preserved (png keeps alpha); an ineffective re-encode is
 * discarded in favour of the original bytes.
 */
function readCover(projectId: string): { buffer: Buffer; mime: string; ext: string } | null {
  const candidates = [
    { file: "cover.png", mime: "image/png", ext: "png", quality: ["-compression_level", "9"] },
    { file: "cover.jpg", mime: "image/jpeg", ext: "jpg", quality: ["-q:v", "5"] },
    { file: "cover.webp", mime: "image/webp", ext: "webp", quality: ["-quality", "75"] },
  ];
  for (const candidate of candidates) {
    const source = join(r2Source, projectId, candidate.file);
    if (!fs.existsSync(source)) continue;
    const original = fs.readFileSync(source);
    const tempDir = fs.mkdtempSync(join(tmpdir(), "workshop-cover-"));
    const temp = join(tempDir, `cover.${candidate.ext}`);
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        source,
        "-vf",
        `scale='min(${COVER_MAX_WIDTH},iw)':-2`,
        ...candidate.quality,
        temp,
      ],
      { encoding: "utf8" },
    );
    const scaled = result.status === 0 && fs.existsSync(temp) ? fs.readFileSync(temp) : null;
    fs.rmSync(tempDir, { recursive: true, force: true });
    const buffer = scaled && scaled.length < original.length ? scaled : original;
    return { buffer, mime: candidate.mime, ext: candidate.ext };
  }
  return null;
}

const blobs = new Map<string, { blobId: string; version: string }>();

function writeR2Object(meta: DatabaseSync, key: string, buffer: Buffer, contentType: string) {
  const blobId = randomBytes(32).toString("hex") + randomBytes(8).toString("hex");
  const version = randomBytes(16).toString("hex");
  fs.mkdirSync(r2BlobDir, { recursive: true });
  fs.writeFileSync(join(r2BlobDir, blobId), buffer);
  meta
    .prepare(
      `INSERT INTO _mf_objects (key, blob_id, version, size, etag, uploaded, checksums, http_metadata, custom_metadata)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, '{}')
       ON CONFLICT(key) DO UPDATE SET blob_id = excluded.blob_id, version = excluded.version,
         size = excluded.size, etag = excluded.etag, uploaded = excluded.uploaded,
         http_metadata = excluded.http_metadata`,
    )
    .run(
      key,
      blobId,
      version,
      buffer.length,
      createHash("md5").update(buffer).digest("hex"),
      Date.now(),
      JSON.stringify({ contentType }),
    );
  blobs.set(key, { blobId, version });
}

const ROLES = new Set<string>(["member", "reviewer", "owner"]);

// Use the same immutable-source decision resolver as the offline migration.
// No title heuristic, old-extension fallback, or duplicate taxonomy convention.
const reviewed = spawnSync(
  pythonPath,
  [
    join(root, "tools/migrate/offline.py"),
    "taxonomy",
    "resolve",
    "--source",
    legacyDbPath,
    "--review",
    taxonomyReviewPath,
    "--source-kind",
    "preview",
  ],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
if (reviewed.status !== 0) throw new Error("Taxonomy review is unresolved, stale, or invalid; preview is unchanged");
const resolvedTaxonomy: unknown = JSON.parse(reviewed.stdout);
if (!resolvedTaxonomy || typeof resolvedTaxonomy !== "object" || !("classifications" in resolvedTaxonomy)) {
  throw new Error("Invalid reviewed taxonomy response");
}
const classificationRows = resolvedTaxonomy.classifications;
if (!classificationRows || typeof classificationRows !== "object" || Array.isArray(classificationRows)) {
  throw new Error("Invalid reviewed taxonomy classifications");
}
// The Python resolver already validates taxonomy/tags. Preserve its serialized
// JSON rather than introducing a second validator or requiring a package build.
const classifications = new Map<string, { projectType: string; includedTypes: string; tags: string }>();
for (const [id, row] of Object.entries(classificationRows)) {
  if (
    !row ||
    typeof row !== "object" ||
    !("project_type" in row) ||
    !("included_types" in row) ||
    !("tags" in row) ||
    typeof row.project_type !== "string" ||
    typeof row.tags !== "string" ||
    typeof row.included_types !== "string"
  )
    throw new Error("Invalid reviewed classification");
  classifications.set(id, { projectType: row.project_type, includedTypes: row.included_types, tags: row.tags });
}

const legacy = new DatabaseSync(legacyDbPath, { readOnly: true });

const users = legacy
  .prepare("SELECT id, username, global_name, avatar, role, created_at, updated_at FROM users")
  .all() as LegacyUser[];
const projects = legacy
  .prepare(
    `SELECT id, author_id, description,
            published_revision_id, published_at, created_at, updated_at
     FROM projects
     WHERE deleted_at IS NULL AND visibility = 'public' AND published_revision_id IS NOT NULL
     ORDER BY published_at DESC
     LIMIT ?`,
  )
  .all(LIMIT) as LegacyProject[];
const revisions = new Map<string, LegacyRevision>();
for (const revision of legacy
  .prepare(
    `SELECT id, title, description, manifest_hash, created_by, created_at, version_label,
            cover_position_x, cover_position_y, cover_zoom
     FROM project_revisions`,
  )
  .all() as LegacyRevision[]) {
  revisions.set(revision.id, revision);
}
const assetsByProject = new Map<string, string[]>();
for (const asset of legacy.prepare("SELECT project_id, kind FROM assets").all() as LegacyAsset[]) {
  const kinds = assetsByProject.get(asset.project_id) ?? [];
  kinds.push(asset.kind);
  assetsByProject.set(asset.project_id, kinds);
}

const db = new DatabaseSync(d1Path);
const meta = new DatabaseSync(r2MetaPath);
db.exec("PRAGMA foreign_keys = OFF");
db.exec("BEGIN");

const insertUser = db.prepare(
  `INSERT INTO users (id, username, global_name, avatar, role, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET global_name = excluded.global_name, avatar = excluded.avatar`,
);
const insertVersion = db.prepare(
  `INSERT INTO project_versions
   (id, project_id, version_no, title, description, project_type, included_types, tags, manifest_hash,
    worldbook_count, regex_count, schema_version, created_by, created_at, version_label,
    cover_position_x, cover_position_y, cover_zoom, entry_index, requirements)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL)`,
);
const insertAsset = db.prepare(
  `INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insertProject = db.prepare(
  `INSERT INTO projects
   (id, author_id, visibility, working_version_id, published_version_id, published_at,
    downloads_count, likes_count, subscriptions_count, row_version, created_at, updated_at,
    deleted_at, published_cover_asset_id, published_updated_at)
   VALUES (?, ?, 'public', ?, ?, ?, 0, 0, 0, 1, ?, ?, NULL, NULL, ?)`,
);
// `INSERT OR REPLACE` would leave the old FTS rows behind: SQLite only fires
// delete triggers for REPLACE with `recursive_triggers`, and the search tables
// are owned exclusively by triggers. Delete first so `project_search_delete`
// runs, then insert as a plain row.
const deleteProject = db.prepare("DELETE FROM projects WHERE id = ?");
const deleteVersions = db.prepare("DELETE FROM project_versions WHERE project_id = ?");
const deleteAssets = db.prepare("DELETE FROM assets WHERE project_id = ?");
const refreshSearch = db.prepare("UPDATE projects SET published_version_id = published_version_id WHERE id = ?");

for (const user of users) {
  const role = ROLES.has(user.role) ? user.role : "member";
  insertUser.run(user.id, user.username, user.global_name, user.avatar, role, user.created_at, user.updated_at);
}

let loaded = 0;
let skipped = 0;
for (const project of projects) {
  const revision = revisions.get(project.published_revision_id);
  const cover = readCover(project.id);
  if (!revision || !cover) {
    skipped += 1;
    continue;
  }

  const presentKinds = (assetsByProject.get(project.id) ?? []).filter(
    (kind): kind is "worldbook" | "regex" =>
      (kind === "worldbook" || kind === "regex") && fs.existsSync(projectContentFile(project.id, kind)),
  );
  const entries = buildEntryIndex(project.id, presentKinds);
  const worldbookCount = entries.filter((entry) => entry.kind === "worldbook").length;
  const regexCount = entries.filter((entry) => entry.kind === "regex").length;

  const classification = classifications.get(revision.id);
  if (!classification) throw new Error("Published revision has no reviewed taxonomy classification");
  const versionId = revision.id;

  // Replace atomically by hand: FTS tables are trigger-owned, and a REPLACE
  // leaves stale search rows behind, so delete the old rows first.
  deleteProject.run(project.id);
  deleteVersions.run(project.id);
  deleteAssets.run(project.id);

  insertVersion.run(
    versionId,
    project.id,
    1,
    revision.title,
    revision.description ?? project.description,
    classification.projectType,
    classification.includedTypes,
    classification.tags,
    revision.manifest_hash,
    worldbookCount,
    regexCount,
    revision.created_by,
    revision.created_at,
    revision.version_label,
    revision.cover_position_x ?? 50,
    revision.cover_position_y ?? 50,
    revision.cover_zoom ?? 1,
    JSON.stringify({ schemaVersion: 1, entries }),
  );

  const coverHash = sha256(cover.buffer);
  const coverKey = `covers/${project.id}/${coverHash}.${cover.ext}`;
  writeR2Object(meta, coverKey, cover.buffer, cover.mime);
  insertAsset.run(
    `legacy-${project.id}-cover`,
    project.id,
    versionId,
    "cover",
    coverKey,
    coverHash,
    cover.buffer.length,
    cover.mime,
    revision.created_at,
  );

  for (const kind of presentKinds) {
    const buffer = fs.readFileSync(projectContentFile(project.id, kind));
    const hash = sha256(buffer);
    const key = `projects/${project.id}/${kind}-${hash}.json`;
    writeR2Object(meta, key, buffer, "application/json");
    insertAsset.run(
      `legacy-${project.id}-${kind}`,
      project.id,
      versionId,
      kind,
      key,
      hash,
      buffer.length,
      "application/json",
      revision.created_at,
    );
  }

  insertProject.run(
    project.id,
    project.author_id,
    versionId,
    versionId,
    project.published_at,
    project.created_at,
    project.updated_at,
    project.published_at,
  );
  refreshSearch.run(project.id);
  loaded += 1;
}

db.exec("COMMIT");
db.exec("PRAGMA foreign_keys = ON");

console.log(`loaded ${loaded} projects, skipped ${skipped}`);
console.log("public projects:", db.prepare("SELECT count(*) AS c FROM projects WHERE visibility='public'").get());
console.log("search rows:", db.prepare("SELECT count(*) AS c FROM project_search").get());
console.log("assets:", db.prepare("SELECT count(*) AS c FROM assets").get());
