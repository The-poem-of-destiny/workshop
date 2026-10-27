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
}

function verifyIdentities({ users, projects, revisions, assets, indexes }, mismatches) {
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
}

function verifyProjectRelations({ users, projects, revisions, userIds, projectIds, revisionsById }, mismatches) {
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
}

function verifyAssetRelations(target, { assets, projectIds, revisionsById }, mismatches) {
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
  return assetsByRevision;
}

function verifyEntryIndexes({ indexes, revisions, revisionsById }, assetsByRevision, mismatches) {
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
}

export function verify(target) {
  const mismatches = [];
  const tables = target?.tables ?? {};
  verifyTables(tables, mismatches);
  const projects = Array.isArray(tables.projects) ? tables.projects : [];
  const revisions = Array.isArray(tables.project_revisions) ? tables.project_revisions : [];
  const assets = Array.isArray(tables.assets) ? tables.assets : [];
  const indexes = Array.isArray(tables.revision_entry_index) ? tables.revision_entry_index : [];
  const users = Array.isArray(tables.users) ? tables.users : [];
  const userIds = new Set(users.map((row) => row.id));
  const projectIds = new Set(projects.map((row) => row.id));
  const revisionsById = new Map(revisions.map((row) => [row.id, row]));
  const rows = { users, projects, revisions, assets, indexes, userIds, projectIds, revisionsById };
  verifyExpectedProjects(target, projects, mismatches);
  verifyIdentities(rows, mismatches);
  verifyProjectRelations(rows, mismatches);
  const assetsByRevision = verifyAssetRelations(target, rows, mismatches);
  verifyEntryIndexes(rows, assetsByRevision, mismatches);
  return {
    ok: mismatches.length === 0,
    checks: { projects: projects.length, assets: assets.length, indexedEntries: indexes.length },
    mismatches,
  };
}
