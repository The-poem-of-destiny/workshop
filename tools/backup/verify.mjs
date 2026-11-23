#!/usr/bin/env node
/**
 * Verify a backup export without touching the live database.
 * Usage: node tools/backup/verify.mjs --tables <dir> --r2 <dir>
 *
 * Required table files: projects.json, project_versions.json, assets.json.
 * Every asset row must have matching bytes and sha256 at its exact r2_key under
 * the R2 mirror; project version and cover pointers must stay within the same project.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_TABLES = ["projects", "project_versions", "assets"];

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  return null;
}

function readTable(dir, name, failures) {
  const file = join(dir, `${name}.json`);
  if (!existsSync(file) || !statSync(file).isFile()) {
    failures.push({ kind: "missing_table", table: name });
    return [];
  }
  const parsed = rows(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed) {
    failures.push({ kind: "invalid_table", table: name });
    return [];
  }
  return parsed;
}

function withinRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function verifyProjectPointers(projects, versionsByKey, assetsByKey, failures) {
  for (const project of projects) {
    for (const field of ["published_version_id", "working_version_id"]) {
      const versionId = project[field];
      if (!versionId) continue;
      if (!versionsByKey.has(`${project.id}:${versionId}`)) {
        failures.push({ kind: "pointer", project: project.id, field, versionId });
      }
    }
    const coverAssetId = project.published_cover_asset_id;
    if (coverAssetId) {
      const cover = assetsByKey.get(`${project.id}:${coverAssetId}`);
      if (!cover || cover.kind !== "cover" || cover.version_id !== null) {
        failures.push({
          kind: "pointer",
          project: project.id,
          field: "published_cover_asset_id",
          assetId: coverAssetId,
        });
      }
    }
  }
}

function verifyAssetRow(r2, asset, failures) {
  const key = asset.r2_key;
  if (typeof key !== "string" || !key || key.startsWith("/") || key.includes("\\")) {
    failures.push({ kind: "asset_key", asset: asset.id ?? null });
    return false;
  }
  const candidate = resolve(r2, key);
  if (!withinRoot(r2, candidate)) {
    failures.push({ kind: "asset_key", asset: asset.id ?? null, key });
    return false;
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    failures.push({ kind: "missing_asset", key });
    return true;
  }
  const body = readFileSync(candidate);
  const actualSha = createHash("sha256").update(body).digest("hex");
  if (asset.sha256 && actualSha !== String(asset.sha256).toLowerCase()) {
    failures.push({ kind: "sha256", key, expected: asset.sha256, actual: actualSha });
  }
  if (asset.bytes != null && body.length !== Number(asset.bytes)) {
    failures.push({ kind: "bytes", key, expected: Number(asset.bytes), actual: body.length });
  }
  return true;
}

export function verifyBackup(tablesDir, r2Dir) {
  const tables = resolve(tablesDir);
  const r2 = resolve(r2Dir);
  const failures = [];
  const loaded = Object.fromEntries(REQUIRED_TABLES.map((name) => [name, readTable(tables, name, failures)]));
  const { projects, project_versions: versions, assets } = loaded;

  const versionsByKey = new Map();
  for (const version of versions) {
    versionsByKey.set(`${version.project_id}:${version.id}`, version);
  }
  const assetsByKey = new Map();
  for (const asset of assets) {
    if (asset.project_id && asset.id) {
      assetsByKey.set(`${asset.project_id}:${asset.id}`, asset);
    }
  }

  verifyProjectPointers(projects, versionsByKey, assetsByKey, failures);

  let checked = 0;
  for (const asset of assets) {
    if (verifyAssetRow(r2, asset, failures)) checked += 1;
  }

  return {
    ok: failures.length === 0,
    checked: { assets: checked, projects: projects.length, versions: versions.length },
    failures,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const tables = arg("tables");
  const r2 = arg("r2");
  if (!tables || !r2) {
    console.error("Usage: node tools/backup/verify.mjs --tables <dir> --r2 <dir>");
    process.exit(2);
  }
  const report = verifyBackup(tables, r2);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
