import { manifestHash } from "./assets.mjs";
import { SHA256, stableStringify, TABLES, text } from "./values.mjs";

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

function verifyTables(tables, mismatches) {
  for (const name of TABLES) if (!Array.isArray(tables[name])) mismatches.push({ check: "missing_table", table: name });
  for (const [name, rows] of Object.entries(tables))
    if (!TABLES.includes(name) && Array.isArray(rows) && rows.length)
      mismatches.push({ check: "unsupported_table", table: name });
}

function verifyExpectedProjects(target, projects, mismatches) {
  const expectedIds = target?.meta?.expectedProjectIds;
  if (target?.meta?.expectedProjectCount !== projects.length)
    mismatches.push({ check: "project_count", expected: target?.meta?.expectedProjectCount, actual: projects.length });
  if (
    Array.isArray(expectedIds) &&
    stableStringify(expectedIds) !== stableStringify(projects.map((row) => row.id).sort())
  )
    mismatches.push({ check: "project_identity", expected: expectedIds, actual: projects.map((row) => row.id).sort() });
  const publishedProjectIds = projects
    .filter((project) => project.published_version_id)
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
}

function verifyIdentities({ users, projects, versions, assets, indexes }, mismatches) {
  for (const [table, rows, key] of [
    ["users", users, (row) => row.id],
    ["projects", projects, (row) => row.id],
    ["project_versions", versions, (row) => row.id],
    ["assets", assets, (row) => row.id],
    ["version_entry_index", indexes, (row) => `${row.version_id}:${row.kind}:${row.entry_key}`],
  ]) {
    const duplicate = duplicateValues(rows, key);
    if (duplicate.length) mismatches.push({ check: "duplicate_ids", table, ids: duplicate });
  }
}

function verifyProjectRelations({ users, projects, versions, userIds, projectIds, versionsById }, mismatches) {
  const versionCounts = new Map();
  for (const version of versions)
    versionCounts.set(version.project_id, (versionCounts.get(version.project_id) ?? 0) + 1);
  for (const user of users) if (user.role !== "member") mismatches.push({ check: "legacy_role", id: user.id });
  for (const project of projects) {
    if (project.visibility !== "public") mismatches.push({ check: "project_visibility", id: project.id });
    if (!userIds.has(project.author_id))
      mismatches.push({ check: "fk", table: "projects", id: project.id, field: "author_id" });
    if (versionCounts.get(project.id) !== 1) mismatches.push({ check: "current_version_count", id: project.id });
    for (const field of ["working_version_id", "published_version_id"]) {
      const version = versionsById.get(project[field]);
      if (!version || version.project_id !== project.id)
        mismatches.push({ check: "pointer_owner", table: "projects", id: project.id, field });
    }
  }
  for (const version of versions) {
    if (!projectIds.has(version.project_id) || !userIds.has(version.created_by))
      mismatches.push({ check: "fk", table: "project_versions", id: version.id });
    if (typeof version.entry_index !== "string") mismatches.push({ check: "missing_entry_index", id: version.id });
    for (const field of ["facets", "custom_tags", "metadata"])
      if (field in version) mismatches.push({ check: "dead_version_field", id: version.id, field });
  }
}

function verifyAssetRelations(target, { assets, projectIds, versionsById }, mismatches) {
  for (const asset of assets) {
    const version = versionsById.get(asset.version_id);
    if (!projectIds.has(asset.project_id) || !version || version.project_id !== asset.project_id)
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
  const assetsByVersion = new Map();
  for (const asset of assets) {
    const rows = assetsByVersion.get(asset.version_id) ?? [];
    rows.push(asset);
    assetsByVersion.set(asset.version_id, rows);
  }
  for (const [versionId, versionAssets] of assetsByVersion) {
    const duplicateKinds = duplicateValues(versionAssets, (asset) => asset.kind);
    if (duplicateKinds.length)
      mismatches.push({ check: "duplicate_asset_kind", version_id: versionId, kinds: duplicateKinds });
  }
  return assetsByVersion;
}

function verifyEntryIndexes({ indexes, versions, versionsById }, assetsByVersion, mismatches) {
  const indexCounts = new Map();
  for (const index of indexes) {
    const versionAssets = assetsByVersion.get(index.version_id) ?? [];
    if (!versionsById.has(index.version_id) || !["worldbook", "regex"].includes(index.kind))
      mismatches.push({ check: "fk", table: "version_entry_index", id: index.version_id });
    else if (!versionAssets.some((asset) => asset.kind === index.kind))
      mismatches.push({ check: "index_asset_kind", version_id: index.version_id, kind: index.kind });
    const counts = indexCounts.get(index.version_id) ?? { worldbook: 0, regex: 0 };
    if (index.kind === "worldbook" || index.kind === "regex") counts[index.kind] += 1;
    indexCounts.set(index.version_id, counts);
  }
  for (const version of versions) {
    const counts = indexCounts.get(version.id) ?? { worldbook: 0, regex: 0 };
    if (version.worldbook_count !== counts.worldbook || version.regex_count !== counts.regex)
      mismatches.push({ check: "entry_counts", id: version.id, expected: counts });
    if (counts.worldbook + counts.regex === 0) mismatches.push({ check: "published_empty_content", id: version.id });
    const actualManifest = manifestHash(assetsByVersion.get(version.id) ?? []);
    if (version.manifest_hash !== actualManifest)
      mismatches.push({
        check: "manifest_hash",
        id: version.id,
        expected: actualManifest,
        actual: version.manifest_hash,
      });
  }
}

export function verify(target) {
  const mismatches = [];
  const tables = target?.tables ?? {};
  verifyTables(tables, mismatches);
  const projects = Array.isArray(tables.projects) ? tables.projects : [];
  const versions = Array.isArray(tables.project_versions) ? tables.project_versions : [];
  const assets = Array.isArray(tables.assets) ? tables.assets : [];
  const indexes = versions.flatMap((version) => {
    try {
      const document = JSON.parse(version.entry_index);
      if (document.schemaVersion !== 1 || !Array.isArray(document.entries)) throw new Error("Invalid index");
      return document.entries.map((entry) => ({
        version_id: version.id,
        kind: entry.kind,
        entry_key: entry.entryKey,
        name: entry.name,
        content_hash: entry.contentHash,
        content_length: entry.contentLength,
      }));
    } catch {
      mismatches.push({ check: "invalid_entry_index", id: version.id });
      return [];
    }
  });
  const users = Array.isArray(tables.users) ? tables.users : [];
  const userIds = new Set(users.map((row) => row.id));
  const projectIds = new Set(projects.map((row) => row.id));
  const versionsById = new Map(versions.map((row) => [row.id, row]));
  const rows = { users, projects, versions, assets, indexes, userIds, projectIds, versionsById };
  verifyExpectedProjects(target, projects, mismatches);
  verifyIdentities(rows, mismatches);
  verifyProjectRelations(rows, mismatches);
  const assetsByVersion = verifyAssetRelations(target, rows, mismatches);
  verifyEntryIndexes(rows, assetsByVersion, mismatches);
  return {
    ok: mismatches.length === 0,
    checks: { projects: projects.length, assets: assets.length, indexedEntries: indexes.length },
    mismatches,
  };
}
