#!/usr/bin/env node
/**
 * Apply an already-verified import package to workshop-staging only.
 *
 * This tool never reads .env or ~/.wrangler config for credentials. The caller
 * must inject an authorized STAGING_IMPORT_TOKEN explicitly in the environment;
 * only that value is passed to Wrangler. It refuses production resource names, captures a
 * before-snapshot and Time Travel bookmark, preflights for ID conflicts, uploads
 * content-addressed R2 objects, executes additive SQL, and verifies the public
 * API. `--apply` is required for any mutation; the default is a read-only
 * preflight.
 *
 * Usage:
 *   STAGING_IMPORT_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *     node tools/migrate/import-staging.mjs --package data_backup/staging-import-100-20261025
 *   ... --apply
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sealImportPackage } from "./import-package.mjs";
import { ensureR2Object, r2ImportCredentials } from "./import-r2.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = path.join(root, "apps/worker/wrangler.jsonc");
const wranglerBin = path.join(root, "apps/worker/node_modules/.bin/wrangler");
const DATABASE = "workshop-staging";
const BUCKET = "workshop-client-staging";
const STAGING_ORIGIN = "https://workshop-staging.poem-of-destiny.workers.dev";
const PRODUCTION_MARKERS = /(^|-)(prod|production)(-|$)/i;

function arg(name, fallback) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const apply = process.argv.includes("--apply");
const packageDir = path.resolve(arg("package", ""));
const baseUrl = (arg("base-url", STAGING_ORIGIN) ?? STAGING_ORIGIN).replace(/\/$/, "");
const token = process.env.STAGING_IMPORT_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const isolatedCwd = mkdtempSync(path.join(os.tmpdir(), "workshop-staging-import-"));

function fail(message) {
  throw new Error(message);
}

function assertStaging(value, label) {
  if (!value || PRODUCTION_MARKERS.test(value)) fail(`${label} must be a staging resource, got: ${value}`);
}

assertStaging(DATABASE, "database");
assertStaging(BUCKET, "bucket");
if (new URL(baseUrl).hostname !== new URL(STAGING_ORIGIN).hostname) fail(`--base-url must be ${STAGING_ORIGIN}`);
if (!token)
  fail("STAGING_IMPORT_TOKEN is required (inject an authorized staging credential; this tool does not read .env)");
if (!accountId) fail("CLOUDFLARE_ACCOUNT_ID is required");
const r2Credentials = apply ? r2ImportCredentials(process.env) : null;

// A temporary, empty working directory keeps Wrangler from loading the
// repository's machine-local .env. Only the explicitly injected variables are forwarded.
const childEnv = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
  LANG: process.env.LANG ?? "C.UTF-8",
  CI: "1",
  WRANGLER_SEND_METRICS: "false",
  HTTPS_PROXY: process.env.HTTPS_PROXY ?? process.env.https_proxy ?? "",
  HTTP_PROXY: process.env.HTTP_PROXY ?? process.env.http_proxy ?? "",
  NO_PROXY: process.env.NO_PROXY ?? process.env.no_proxy ?? "",
  CLOUDFLARE_API_TOKEN: token,
  CLOUDFLARE_ACCOUNT_ID: accountId,
};

function wrangler(args, { allowFailure = false } = {}) {
  const result = spawnSync(wranglerBin, [...args, "--config", config, "--env", "staging"], {
    cwd: isolatedCwd,
    encoding: "utf8",
    env: childEnv,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure)
    fail(`wrangler ${args.slice(0, 2).join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  return result;
}

function d1Rows(sql) {
  const result = wrangler(["d1", "execute", DATABASE, "--remote", "--json", "--command", sql]);
  const parsed = JSON.parse(result.stdout);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first?.success) fail(`D1 query failed: ${result.stdout}`);
  return first.results ?? [];
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function fetchBuffer(url, timeout = 30) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = spawnSync(
      "curl",
      [
        "-fsS",
        "--connect-timeout",
        "10",
        "--max-time",
        String(timeout),
        "--retry",
        "2",
        "--retry-delay",
        "1",
        "-A",
        "workshop-staging-import/1.0",
        url,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.status === 0) return result.stdout;
    lastError = new Error(`GET ${url} failed: ${result.stderr?.toString().trim() || result.status}`);
  }
  throw lastError;
}

async function getJson(url) {
  return { response: { status: 200 }, body: JSON.parse(fetchBuffer(url, 20).toString("utf8")) };
}

async function getBytes(url) {
  return fetchBuffer(url, 30);
}

async function publicIds() {
  const ids = [];
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const { body } = await getJson(`${baseUrl}/api/v1/projects?${query}`);
    for (const item of body.items ?? []) ids.push(item.id);
    cursor = body.nextCursor;
    if (!cursor) return ids;
  }
  fail("public pagination exceeded 50 pages");
}

function sqlList(values) {
  return values.map((value) => `'${String(value).replaceAll("'", "''")}'`).join(",");
}

function snapshot(ids, assets, revisions, users) {
  const row = d1Rows(`SELECT
    (SELECT count(*) FROM projects) AS projects,
    (SELECT count(*) FROM project_revisions) AS revisions,
    (SELECT count(*) FROM assets) AS assets,
    (SELECT count(*) FROM revision_entry_index) AS entries,
    (SELECT count(*) FROM users WHERE id IN (${sqlList(users)})) AS existing_users,
    (SELECT count(*) FROM projects WHERE id IN (${sqlList(ids)})) AS conflicting_projects,
    (SELECT count(*) FROM project_revisions WHERE id IN (${sqlList(revisions)})) AS conflicting_revisions,
    (SELECT count(*) FROM assets WHERE id IN (${sqlList(assets)})) AS conflicting_assets;
  `)[0];
  return row;
}

function timeTravel() {
  const result = wrangler(["d1", "time-travel", "info", DATABASE, "--json"]);
  return JSON.parse(result.stdout);
}

if (!packageDir) fail("--package is required");
if (!existsSync(packageDir)) fail(`package not found: ${packageDir}`);
const { target, manifest, sourceDir, sqlPath } = sealImportPackage({ packageDir, isolatedCwd });

const projectIds = target.tables.projects.map((row) => row.id);
const revisionIds = target.tables.project_revisions.map((row) => row.id);
const assetIds = target.tables.assets.map((row) => row.id);
if (projectIds.length !== 100) fail(`expected 100 projects, got ${projectIds.length}`);
if (new Set(projectIds).size !== projectIds.length) fail("duplicate project IDs in package");

const userIds = target.tables.users.map((row) => row.id);
const beforeApiIds = await publicIds();
const before = snapshot(projectIds, assetIds, revisionIds, userIds);
const bookmark = timeTravel();
const beforeReceipt = {
  environment: "staging",
  database: DATABASE,
  bucket: BUCKET,
  createdAt: new Date().toISOString(),
  sqlSha256: sha256(sqlPath),
  packageProjects: projectIds.length,
  packageAssets: manifest.objects.length,
  packageBytes: manifest.objects.reduce((sum, object) => sum + object.bytes, 0),
  publicProjectsBefore: beforeApiIds.length,
  databaseCounts: before,
  timeTravel: bookmark,
};
if (before.conflicting_projects || before.conflicting_revisions || before.conflicting_assets)
  fail(`destination already contains package IDs: ${JSON.stringify(before)}`);

if (!apply) {
  writeFileSync(path.join(packageDir, "remote-preflight.json"), `${JSON.stringify(beforeReceipt, null, 2)}\n`);
  console.log(
    JSON.stringify({
      ok: true,
      mode: "preflight",
      environment: "staging",
      publicProjectsBefore: beforeApiIds.length,
      databaseCounts: before,
      packageProjects: projectIds.length,
      packageAssets: manifest.objects.length,
      packageBytes: beforeReceipt.packageBytes,
      next: "rerun with --apply to upload assets and execute additive SQL",
    }),
  );
  rmSync(isolatedCwd, { recursive: true, force: true });
  process.exit(0);
}

const uploaded = [];
try {
  for (const object of manifest.objects) {
    uploaded.push(
      await ensureR2Object({
        accountId,
        bucket: BUCKET,
        key: object.targetKey,
        body: readFileSync(path.join(sourceDir, object.targetKey)),
        sha256: object.sha256,
        bytes: object.bytes,
        credentials: r2Credentials,
      }),
    );
  }

  const execution = wrangler(["d1", "execute", DATABASE, "--remote", "--file", sqlPath]);
  writeFileSync(path.join(packageDir, "remote-sql.log"), `${execution.stdout}\n${execution.stderr}\n`);

  const after = d1Rows(`SELECT
    (SELECT count(*) FROM projects) AS projects,
    (SELECT count(*) FROM project_revisions) AS revisions,
    (SELECT count(*) FROM assets) AS assets,
    (SELECT count(*) FROM revision_entry_index) AS entries,
    (SELECT count(*) FROM projects WHERE id IN (${sqlList(projectIds)}) AND published_revision_id IS NOT NULL) AS published_package_projects,
    (SELECT count(*) FROM assets WHERE id IN (${sqlList(assetIds)})) AS package_assets,
    (SELECT count(*) FROM revision_entry_index WHERE revision_id IN (${sqlList(revisionIds)})) AS package_entries;
  `)[0];
  if (after.projects !== before.projects + projectIds.length)
    fail(`project count did not increase by ${projectIds.length}: ${JSON.stringify(after)}`);
  if (after.published_package_projects !== projectIds.length) fail("not every imported project is published");
  if (after.package_assets !== assetIds.length) fail("missing imported asset rows");
  if (after.package_entries !== target.tables.revision_entry_index.length) fail("missing imported index rows");
  writeFileSync(
    path.join(packageDir, "remote-post-sql.json"),
    `${JSON.stringify({ ...beforeReceipt, appliedAt: new Date().toISOString(), databaseCountsAfter: after, uploaded }, null, 2)}\n`,
  );

  const afterApiIds = await publicIds();
  if (afterApiIds.length !== beforeApiIds.length + projectIds.length)
    fail(`public project count ${afterApiIds.length} != ${beforeApiIds.length} + ${projectIds.length}`);
  if (new Set(afterApiIds).size !== afterApiIds.length) fail("public pagination returned duplicates");
  const missingFromApi = projectIds.filter((id) => !afterApiIds.includes(id));
  if (missingFromApi.length) fail(`projects missing from public pagination: ${missingFromApi.slice(0, 5)}`);

  const covers = new Map();
  for (const asset of target.tables.assets) if (asset.kind === "cover") covers.set(asset.project_id, asset);
  const details = [];
  for (const project of target.tables.projects) {
    const { body: detail } = await getJson(`${baseUrl}/api/v1/projects/${project.id}`);
    const revision = target.tables.project_revisions.find((row) => row.id === project.published_revision_id);
    if (!revision) fail(`missing revision for ${project.id}`);
    if (detail.entries?.worldbook !== revision.worldbook_count || detail.entries?.regex !== revision.regex_count)
      fail(`entry counts differ for ${project.id}`);
    if (!detail.coverUrl) fail(`missing cover URL for ${project.id}`);
    const coverBytes = await getBytes(`${baseUrl}${detail.coverUrl}`);
    const cover = covers.get(project.id);
    if (!cover) fail(`missing cover asset for ${project.id}`);
    if (createHash("sha256").update(coverBytes).digest("hex") !== cover.sha256)
      fail(`cover hash mismatch for ${project.id}`);
    details.push({ id: project.id, entries: detail.entries, coverUrl: detail.coverUrl });
  }

  const searchProject = target.tables.projects[0];
  const search = new URLSearchParams({ search: searchProject.title.slice(0, 8), limit: "50" });
  const { body: searchBody } = await getJson(`${baseUrl}/api/v1/projects?${search}`);
  if (!(searchBody.items ?? []).some((item) => item.id === searchProject.id))
    fail(`search did not return ${searchProject.id}`);

  const receipt = {
    ...beforeReceipt,
    appliedAt: new Date().toISOString(),
    databaseCountsAfter: after,
    publicProjectsAfter: afterApiIds.length,
    uploaded,
    details,
    search: { query: search.get("search"), matched: searchProject.id },
    productionTouched: false,
    deletes: 0,
    updates: 0,
  };
  writeFileSync(path.join(packageDir, "remote-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    JSON.stringify({
      ok: true,
      mode: "apply",
      environment: "staging",
      publicProjectsBefore: beforeApiIds.length,
      publicProjectsAfter: afterApiIds.length,
      databaseCountsAfter: after,
      uploaded: uploaded.length,
      coverChecks: details.length,
      receipt: path.join(packageDir, "remote-receipt.json"),
    }),
  );
} catch (error) {
  writeFileSync(
    path.join(packageDir, "remote-failure.json"),
    `${JSON.stringify(
      {
        ...beforeReceipt,
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        uploaded,
      },
      null,
      2,
    )}\n`,
  );
  throw error;
} finally {
  rmSync(isolatedCwd, { recursive: true, force: true });
}
