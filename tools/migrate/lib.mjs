import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { extractProjectEntries, validateProjectContentText } from "../../packages/domain/src/project-content.ts";
import {
  normalizeExtensionType,
  normalizeProjectType,
  resolveProjectType,
} from "../../packages/domain/src/taxonomy.ts";

const SOURCE_TABLES = ["users", "projects", "assets"];
const TABLES = ["users", "projects", "project_revisions", "assets", "revision_entry_index"];
const SHA256 = /^[a-f0-9]{64}$/i;

const text = (value) => (typeof value === "string" ? value : value == null ? "" : String(value));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const stableRows = (rows) =>
  [...rows].sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
const generatedId = (prefix, value) => `${prefix}-${hash(value).slice(0, 24)}`;

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function rowsFrom(value) {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === "object");
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.rows)) return value.rows.filter((row) => row && typeof row === "object");
  if (Array.isArray(value.items)) return value.items.filter((row) => row && typeof row === "object");
  return [];
}

/** Read only explicitly named JSON/JSONL source exports. */
export async function extract(sourceDir) {
  const root = path.resolve(sourceDir);
  if (!(await fs.stat(root)).isDirectory()) throw new Error(`source is not a directory: ${sourceDir}`);
  const tables = Object.fromEntries(SOURCE_TABLES.map((name) => [name, []]));
  for (const name of SOURCE_TABLES) {
    for (const extension of ["json", "jsonl", "ndjson"]) {
      const file = path.join(root, `${name}.${extension}`);
      try {
        const raw = await fs.readFile(file, "utf8");
        const value = extension === "json" ? JSON.parse(raw) : raw.split(/\r?\n/).filter(Boolean).map(JSON.parse);
        tables[name].push(...rowsFrom(value));
      } catch (error) {
        if (error && error.code === "ENOENT") continue;
        throw error;
      }
    }
    tables[name] = stableRows(tables[name]);
  }
  return { format: "workshop-public-export-v1", tables };
}

function publicProject(row) {
  return row?.status === "approved" && Number(row.is_published) === 1 && Number(row.visibility) === 1;
}

function timestamps(row) {
  const createdAt = text(row.created_at || row.createdAt);
  const updatedAt = text(row.updated_at || row.updatedAt || createdAt);
  return createdAt && updatedAt ? { created_at: createdAt, updated_at: updatedAt } : null;
}

function stringArray(value) {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })()
      : value;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
}

function decodeAsset(row) {
  const encoded = row.content_base64;
  if (typeof encoded !== "string" || encoded.length === 0) return { ok: false, reason: "missing_content_base64" };
  const normalized = encoded.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0)
    return { ok: false, reason: "invalid_content_base64" };
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64") !== normalized) return { ok: false, reason: "invalid_content_base64" };
  const sha256 = text(row.sha256).toLowerCase();
  if (!SHA256.test(sha256)) return { ok: false, reason: "invalid_sha256" };
  if (hash(bytes) !== sha256) return { ok: false, reason: "sha256_mismatch" };
  if (!Number.isInteger(row.bytes) || row.bytes !== bytes.byteLength || row.bytes < 0)
    return { ok: false, reason: "byte_count_mismatch" };
  return { ok: true, bytes, sha256 };
}

function indexedEntries(raw, kind) {
  return extractProjectEntries(raw, kind).map(({ entry, entryKey }) => {
    const entry_key = entryKey;
    const content =
      typeof entry.content === "string"
        ? entry.content
        : typeof entry.replaceString === "string"
          ? entry.replaceString
          : "";
    const name =
      [entry.name, entry.comment, entry.scriptName].find((value) => typeof value === "string" && value.trim()) ||
      entry_key;
    return {
      kind,
      entry_key,
      name,
      content_hash: hash(content),
      content_length: Array.from(content).length,
    };
  });
}

function validateContentAsset(asset) {
  const decoded = decodeAsset(asset);
  if (!decoded.ok) return decoded;
  const content = decoded.bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(decoded.bytes)) return { ok: false, reason: "content_not_utf8" };
  try {
    const validation = validateProjectContentText(content, asset.kind);
    if (!validation.valid) return { ok: false, reason: `invalid_${asset.kind}_content:${validation.error}` };
    const entries = indexedEntries(JSON.parse(content), asset.kind);
    if (validation.entryCount !== entries.length) return { ok: false, reason: "content_index_mismatch" };
    return { ok: true, sha256: decoded.sha256, entries };
  } catch (error) {
    return {
      ok: false,
      reason: `invalid_${asset.kind}_content:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function assetRows(project, revision, sourceAssets, skipped) {
  const byKind = new Map();
  for (const source of sourceAssets) {
    const kind = text(source.kind);
    if (!["worldbook", "regex", "cover"].includes(kind)) {
      skipped.push({ project_id: project.id, reason: `unsupported_asset_kind:${kind || "missing"}` });
      continue;
    }
    if (!text(source.r2_key)) {
      const reason = `asset_${kind}_missing_r2_key`;
      if (kind !== "cover") return { ok: false, reason };
      skipped.push({ project_id: project.id, reason });
      continue;
    }
    if (byKind.has(kind)) return { ok: false, reason: `duplicate_${kind}_asset` };
    const decoded = decodeAsset(source);
    if (!decoded.ok) {
      if (kind === "cover") {
        skipped.push({ project_id: project.id, reason: `cover_${decoded.reason}` });
        continue;
      }
      return { ok: false, reason: `${kind}_${decoded.reason}` };
    }
    const content = kind === "cover" ? { ok: true, sha256: decoded.sha256, entries: [] } : validateContentAsset(source);
    if (!content.ok) return { ok: false, reason: `${kind}_${content.reason}` };
    byKind.set(kind, {
      id: generatedId("asset", `${project.id}:${revision.id}:${kind}`),
      project_id: project.id,
      revision_id: revision.id,
      kind,
      r2_key: kind === "cover" ? `covers/imported/${content.sha256}` : text(source.r2_key),
      source_key: text(source.r2_key),
      sha256: content.sha256,
      bytes: source.bytes,
      mime: text(source.mime || (kind === "cover" ? "application/octet-stream" : "application/json")),
      created_at: revision.created_at,
      entries: content.entries,
    });
  }
  if (!byKind.has("worldbook") && !byKind.has("regex")) return { ok: false, reason: "missing_released_content" };
  return { ok: true, values: [...byKind.values()] };
}

function manifestHash(assets) {
  return hash(
    [...assets]
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.r2_key.localeCompare(right.r2_key))
      .map((asset) => `${asset.kind}:${asset.sha256}`)
      .join("\n"),
  );
}

export function transform(source) {
  const skipped = [];
  const sourceTables = source?.tables ?? {};
  const rawUsers = Array.isArray(sourceTables.users) ? sourceTables.users : [];
  const userById = new Map();
  for (const user of rawUsers) {
    const id = text(user.id);
    const username = text(user.username);
    const times = timestamps(user);
    if (id && username && times && !userById.has(id)) userById.set(id, { ...user, id, username, times });
  }
  const rawAssets = Array.isArray(sourceTables.assets) ? sourceTables.assets : [];
  const assetsByProject = new Map();
  for (const asset of rawAssets) {
    const projectId = text(asset.project_id);
    if (!projectId) continue;
    const rows = assetsByProject.get(projectId) ?? [];
    rows.push(asset);
    assetsByProject.set(projectId, rows);
  }

  const tables = Object.fromEntries(TABLES.map((name) => [name, []]));
  const assetSources = {};
  const selected = (Array.isArray(sourceTables.projects) ? sourceTables.projects : []).filter(publicProject);
  for (const sourceProject of selected) {
    const id = text(sourceProject.id);
    const authorId = text(sourceProject.author_id);
    const author = userById.get(authorId);
    const times = timestamps(sourceProject);
    const title = text(sourceProject.name);
    const tags = stringArray(sourceProject.tags);
    const projectType =
      normalizeProjectType(sourceProject.project_type) ??
      (tags.some((tag) => normalizeProjectType(tag)) ? resolveProjectType(null, tags) : null);
    const extensionType = normalizeExtensionType(sourceProject.extension_type);
    if (!id || !author || !times || !title.trim()) {
      skipped.push({
        project_id: id || null,
        reason: !author ? "missing_member_author" : "missing_required_project_fields",
      });
      continue;
    }
    if (tables.projects.some((project) => project.id === id)) {
      skipped.push({ project_id: id, reason: "duplicate_project_id" });
      continue;
    }
    const revision = {
      id: generatedId("revision", id),
      project_id: id,
      revision_no: 1,
      title,
      description: sourceProject.description ?? null,
      author_note: null,
      project_type: projectType,
      extension_type: extensionType,
      tags: JSON.stringify(tags),
      manifest_hash: null,
      worldbook_count: 0,
      regex_count: 0,
      schema_version: null,
      discord_thread_url: sourceProject.discord_thread_url ?? null,
      created_by: authorId,
      created_at: times.created_at,
      version_label: sourceProject.version_label ?? sourceProject.version ?? null,
      precautions: sourceProject.precautions ?? null,
      cover_position_x: Number.isFinite(sourceProject.cover_position_x) ? sourceProject.cover_position_x : 50,
      cover_position_y: Number.isFinite(sourceProject.cover_position_y) ? sourceProject.cover_position_y : 50,
      cover_zoom: Number.isFinite(sourceProject.cover_zoom) ? sourceProject.cover_zoom : 1,
      metadata_findings: "[]",
      metadata_checker_revision: null,
      metadata_checked_at: null,
      metadata_checked_by: null,
      entry_index_ready: 1,
    };
    const project = {
      id,
      author_id: authorId,
      title,
      description: sourceProject.description ?? null,
      author_note: null,
      project_type: projectType,
      extension_type: extensionType,
      search_tags: JSON.stringify(tags),
      visibility: "public",
      working_revision_id: revision.id,
      published_revision_id: revision.id,
      published_at: sourceProject.latest_approved_at ?? sourceProject.reviewed_at ?? times.updated_at,
      row_version: 1,
      created_at: times.created_at,
      updated_at: times.updated_at,
      version_label: revision.version_label,
      precautions: revision.precautions,
      cover_position_x: revision.cover_position_x,
      cover_position_y: revision.cover_position_y,
      cover_zoom: revision.cover_zoom,
      metadata_findings: "[]",
      metadata_checker_revision: null,
      metadata_checked_at: null,
      metadata_checked_by: null,
      published_schema_version: null,
      published_discord_thread_url: revision.discord_thread_url,
    };
    const builtAssets = assetRows(project, revision, assetsByProject.get(id) ?? [], skipped);
    if (!builtAssets.ok) {
      skipped.push({ project_id: id, reason: builtAssets.reason });
      continue;
    }
    const assets = builtAssets.values;
    const indexes = assets.flatMap((asset) => asset.entries.map((entry) => ({ revision_id: revision.id, ...entry })));
    revision.worldbook_count = indexes.filter((entry) => entry.kind === "worldbook").length;
    revision.regex_count = indexes.filter((entry) => entry.kind === "regex").length;
    revision.manifest_hash = manifestHash(assets);
    tables.projects.push(project);
    tables.project_revisions.push(revision);
    for (const { entries, source_key, ...asset } of assets) {
      tables.assets.push(asset);
      assetSources[asset.id] = source_key;
    }
    tables.revision_entry_index.push(...indexes);
    if (!tables.users.some((user) => user.id === authorId)) {
      tables.users.push({
        id: author.id,
        username: author.username,
        global_name: author.global_name ?? null,
        avatar: author.avatar ?? null,
        role: "member",
        created_at: author.times.created_at,
        updated_at: author.times.updated_at,
      });
    }
  }
  for (const name of TABLES) tables[name] = stableRows(tables[name]);
  const expectedProjectIds = tables.projects.map((project) => project.id).sort();
  const assetSha256 = Object.fromEntries(tables.assets.map((asset) => [asset.id, asset.sha256]));
  return {
    format: "workshop-public-migration-v2",
    meta: {
      selectedSourceProjects: selected.length,
      expectedProjectCount: expectedProjectIds.length,
      expectedProjectIds,
      expectedPublishedPointerCount: expectedProjectIds.length,
      expectedPublishedProjectIds: expectedProjectIds,
      assetSha256,
      assetSources,
      skipped: stableRows(skipped),
    },
    tables,
  };
}

function duplicateValues(rows, key) {
  const seen = new Set();
  const duplicate = [];
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) duplicate.push(value);
    seen.add(value);
  }
  return duplicate;
}

export function verify(target) {
  const mismatches = [];
  const tables = target?.tables ?? {};
  for (const name of TABLES) if (!Array.isArray(tables[name])) mismatches.push({ check: "missing_table", table: name });
  for (const [name, rows] of Object.entries(tables))
    if (!TABLES.includes(name) && Array.isArray(rows) && rows.length)
      mismatches.push({ check: "unsupported_table", table: name });
  const projects = Array.isArray(tables.projects) ? tables.projects : [];
  const revisions = Array.isArray(tables.project_revisions) ? tables.project_revisions : [];
  const assets = Array.isArray(tables.assets) ? tables.assets : [];
  const indexes = Array.isArray(tables.revision_entry_index) ? tables.revision_entry_index : [];
  const users = Array.isArray(tables.users) ? tables.users : [];
  const expectedIds = target?.meta?.expectedProjectIds;
  if (target?.meta?.expectedProjectCount !== projects.length)
    mismatches.push({ check: "project_count", expected: target?.meta?.expectedProjectCount, actual: projects.length });
  if (
    Array.isArray(expectedIds) &&
    stableStringify(expectedIds) !== stableStringify(projects.map((row) => row.id).sort())
  )
    mismatches.push({ check: "project_identity", expected: expectedIds, actual: projects.map((row) => row.id).sort() });
  const publishedProjectIds = projects
    .filter((project) => project.published_revision_id)
    .map((project) => project.id)
    .sort();
  if (target?.meta?.expectedPublishedPointerCount !== publishedProjectIds.length)
    mismatches.push({
      check: "published_pointer_count",
      expected: target?.meta?.expectedPublishedPointerCount,
      actual: publishedProjectIds.length,
    });
  if (
    Array.isArray(target?.meta?.expectedPublishedProjectIds) &&
    stableStringify(target.meta.expectedPublishedProjectIds) !== stableStringify(publishedProjectIds)
  )
    mismatches.push({ check: "published_project_identity", actual: publishedProjectIds });
  for (const [table, rows, key] of [
    ["users", users, (row) => row.id],
    ["projects", projects, (row) => row.id],
    ["project_revisions", revisions, (row) => row.id],
    ["assets", assets, (row) => row.id],
    ["revision_entry_index", indexes, (row) => `${row.revision_id}:${row.kind}:${row.entry_key}`],
  ]) {
    const duplicate = duplicateValues(rows, key);
    if (duplicate.length) mismatches.push({ check: "duplicate_ids", table, ids: duplicate });
  }
  const userIds = new Set(users.map((row) => row.id));
  const projectIds = new Set(projects.map((row) => row.id));
  const revisionsById = new Map(revisions.map((row) => [row.id, row]));
  const revisionCounts = new Map();
  for (const revision of revisions)
    revisionCounts.set(revision.project_id, (revisionCounts.get(revision.project_id) ?? 0) + 1);
  for (const user of users) if (user.role !== "member") mismatches.push({ check: "legacy_role", id: user.id });
  for (const project of projects) {
    if (project.visibility !== "public") mismatches.push({ check: "project_visibility", id: project.id });
    if (!userIds.has(project.author_id))
      mismatches.push({ check: "fk", table: "projects", id: project.id, field: "author_id" });
    if (revisionCounts.get(project.id) !== 1) mismatches.push({ check: "current_revision_count", id: project.id });
    for (const field of ["working_revision_id", "published_revision_id"]) {
      const revision = revisionsById.get(project[field]);
      if (!revision || revision.project_id !== project.id)
        mismatches.push({ check: "pointer_owner", table: "projects", id: project.id, field });
    }
  }
  for (const revision of revisions) {
    if (!projectIds.has(revision.project_id) || !userIds.has(revision.created_by))
      mismatches.push({ check: "fk", table: "project_revisions", id: revision.id });
    if (revision.entry_index_ready !== 1) mismatches.push({ check: "entry_index_ready", id: revision.id });
    for (const field of ["facets", "custom_tags", "metadata"])
      if (field in revision) mismatches.push({ check: "dead_revision_field", id: revision.id, field });
  }
  for (const asset of assets) {
    const revision = revisionsById.get(asset.revision_id);
    if (!projectIds.has(asset.project_id) || !revision || revision.project_id !== asset.project_id)
      mismatches.push({ check: "fk", table: "assets", id: asset.id });
    if (!["worldbook", "regex", "cover"].includes(asset.kind))
      mismatches.push({ check: "asset_kind", id: asset.id, kind: asset.kind });
    if (!text(asset.r2_key) || !text(target?.meta?.assetSources?.[asset.id]))
      mismatches.push({ check: "asset_copy_mapping", id: asset.id });
    if (asset.kind === "cover" && !text(asset.r2_key).startsWith("covers/"))
      mismatches.push({ check: "cover_namespace", id: asset.id });
    if (!SHA256.test(text(asset.sha256)))
      mismatches.push({ check: "asset_sha256", id: asset.id, actual: asset.sha256 });
    if (target?.meta?.assetSha256?.[asset.id] !== asset.sha256)
      mismatches.push({
        check: "asset_sha256",
        id: asset.id,
        expected: target?.meta?.assetSha256?.[asset.id],
        actual: asset.sha256,
      });
  }
  const assetsByRevision = new Map();
  for (const asset of assets) {
    const rows = assetsByRevision.get(asset.revision_id) ?? [];
    rows.push(asset);
    assetsByRevision.set(asset.revision_id, rows);
  }
  for (const [revisionId, revisionAssets] of assetsByRevision) {
    const duplicateKinds = duplicateValues(revisionAssets, (asset) => asset.kind);
    if (duplicateKinds.length)
      mismatches.push({ check: "duplicate_asset_kind", revision_id: revisionId, kinds: duplicateKinds });
  }
  const indexCounts = new Map();
  for (const index of indexes) {
    const revisionAssets = assetsByRevision.get(index.revision_id) ?? [];
    if (!revisionsById.has(index.revision_id) || !["worldbook", "regex"].includes(index.kind))
      mismatches.push({ check: "fk", table: "revision_entry_index", id: index.revision_id });
    else if (!revisionAssets.some((asset) => asset.kind === index.kind))
      mismatches.push({ check: "index_asset_kind", revision_id: index.revision_id, kind: index.kind });
    const counts = indexCounts.get(index.revision_id) ?? { worldbook: 0, regex: 0 };
    if (index.kind === "worldbook" || index.kind === "regex") counts[index.kind] += 1;
    indexCounts.set(index.revision_id, counts);
  }
  for (const revision of revisions) {
    const counts = indexCounts.get(revision.id) ?? { worldbook: 0, regex: 0 };
    if (revision.worldbook_count !== counts.worldbook || revision.regex_count !== counts.regex)
      mismatches.push({ check: "entry_counts", id: revision.id, expected: counts });
    if (counts.worldbook + counts.regex === 0) mismatches.push({ check: "published_empty_content", id: revision.id });
    const actualManifest = manifestHash(assetsByRevision.get(revision.id) ?? []);
    if (revision.manifest_hash !== actualManifest)
      mismatches.push({
        check: "manifest_hash",
        id: revision.id,
        expected: actualManifest,
        actual: revision.manifest_hash,
      });
  }
  return {
    ok: mismatches.length === 0,
    checks: { projects: projects.length, assets: assets.length, indexedEntries: indexes.length },
    mismatches,
  };
}

export function reconcile(expected, target) {
  const counts = {};
  const mismatches = [];
  for (const name of TABLES) {
    const left = stableRows(expected.tables?.[name] ?? []);
    const right = stableRows(target.tables?.[name] ?? []);
    counts[name] = { expected: left.length, actual: right.length };
    if (stableStringify(left) !== stableStringify(right)) {
      const actual = new Set(right.map(stableStringify));
      const expectedRows = new Set(left.map(stableStringify));
      mismatches.push({
        table: name,
        missing: left.filter((row) => !actual.has(stableStringify(row))).slice(0, 20),
        unexpected: right.filter((row) => !expectedRows.has(stableStringify(row))).slice(0, 20),
      });
    }
  }
  return { ok: mismatches.length === 0, counts, mismatches };
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(file, `${stableStringify(value)}\n`, "utf8");
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export { TABLES };
