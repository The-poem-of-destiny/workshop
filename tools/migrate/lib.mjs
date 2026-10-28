import { promises as fs } from "node:fs";
import path from "node:path";
import { assetRows, manifestHash } from "./assets.mjs";
import { memberRow, projectRows, publicProject, sourceAssetsByProject, sourceMembers } from "./entities.mjs";
import { SOURCE_TABLES, stableRows, stableStringify, TABLES } from "./values.mjs";

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

export function transform(source) {
  const skipped = [];
  const sourceTables = source?.tables ?? {};
  const rawUsers = Array.isArray(sourceTables.users) ? sourceTables.users : [];
  const userById = sourceMembers(rawUsers);
  const rawAssets = Array.isArray(sourceTables.assets) ? sourceTables.assets : [];
  const assetsByProject = sourceAssetsByProject(rawAssets);

  const tables = Object.fromEntries(TABLES.map((name) => [name, []]));
  const assetSources = {};
  const selected = (Array.isArray(sourceTables.projects) ? sourceTables.projects : []).filter(publicProject);
  for (const sourceProject of selected) {
    const built = projectRows(sourceProject, userById, tables.projects, skipped);
    if (!built) continue;
    const { project, revision, author } = built;
    const { id, author_id: authorId } = project;
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
      tables.users.push(memberRow(author));
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

export function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/** Additive INSERT statements for verified target rows. Never updates or deletes. */
export function insertSql(table, rows, { columns, onConflict = "" } = {}) {
  if (rows.length === 0) return "";
  const ordered = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  const list = ordered.map(sqlIdentifier).join(", ");
  const suffix = onConflict ? ` ON CONFLICT DO NOTHING` : "";
  return rows
    .map(
      (row) =>
        `INSERT INTO ${sqlIdentifier(table)} (${list}) VALUES (${ordered.map((column) => sqlValue(row[column])).join(", ")})${suffix};`,
    )
    .join("\n");
}

/** Deterministic additive SQL for a verified migration target. */
export function migrationSql(target) {
  const tables = target?.tables ?? {};
  const order = ["users", "projects", "project_revisions", "assets", "revision_entry_index"];
  const covered = ["projects", "assets", "revision_entry_index"].map(
    (name) => `${name}=${(tables[name] ?? []).length}`,
  );
  const header = [
    "-- Additive workshop staging import. Public users, published projects, current",
    "-- revisions, retained assets, and complete entry indexes only.",
    "-- No UPDATE, DELETE, REPLACE, or schema change; conflicts are left untouched.",
    `-- Target: ${covered.join(" ")}`,
    "PRAGMA foreign_keys = ON;",
  ].join("\n");
  const body = order
    .map((name) => insertSql(name, tables[name] ?? [], { columns: undefined, onConflict: true }))
    .filter(Boolean)
    .join("\n");
  return `${header}\n${body}\n`;
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(file, `${stableStringify(value)}\n`, "utf8");
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
