#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBackup } from "./verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const verifyScript = join(here, "verify.mjs");

const dir = await mkdtemp(join(os.tmpdir(), "workshop-backup-"));
try {
  const emptyTables = join(dir, "empty-tables");
  const r2 = join(dir, "r2");
  await mkdir(emptyTables, { recursive: true });
  await mkdir(join(r2, "projects/p1"), { recursive: true });
  await mkdir(join(r2, "covers"), { recursive: true });

  // Empty tables directory MUST fail closed with explicit missing_table failures.
  const emptyReport = verifyBackup(emptyTables, r2);
  assert.equal(emptyReport.ok, false);
  assert.deepEqual(
    emptyReport.failures.filter((item) => item.kind === "missing_table").map((item) => item.table),
    ["projects", "project_versions", "assets"],
  );

  const tables = join(dir, "tables");
  await mkdir(tables, { recursive: true });
  const wbBody = Buffer.from('{"entries":[]}');
  const wbSha = createHash("sha256").update(wbBody).digest("hex");
  const coverBody = Buffer.from("cover-image-bytes");
  const coverSha = createHash("sha256").update(coverBody).digest("hex");
  await writeFile(join(r2, "projects/p1/worldbook.json"), wbBody);
  await writeFile(join(r2, "covers/p1-cover.png"), coverBody);

  const validAssets = [
    {
      id: "a-wb",
      project_id: "p1",
      version_id: "v1",
      kind: "worldbook",
      r2_key: "projects/p1/worldbook.json",
      sha256: wbSha,
      bytes: wbBody.length,
    },
    {
      id: "a-cover",
      project_id: "p1",
      version_id: null,
      kind: "cover",
      r2_key: "covers/p1-cover.png",
      sha256: coverSha,
      bytes: coverBody.length,
    },
  ];
  await writeFile(join(tables, "assets.json"), JSON.stringify(validAssets));
  await writeFile(
    join(tables, "project_versions.json"),
    JSON.stringify([
      { id: "v1", project_id: "p1" },
      { id: "v-other", project_id: "p2" },
    ]),
  );
  await writeFile(
    join(tables, "projects.json"),
    JSON.stringify([
      {
        id: "p1",
        published_version_id: "v1",
        working_version_id: "v1",
        published_cover_asset_id: "a-cover",
      },
    ]),
  );

  const valid = verifyBackup(tables, r2);
  assert.equal(valid.ok, true, JSON.stringify(valid.failures));
  assert.deepEqual(valid.checked, { assets: 2, projects: 1, versions: 2 });

  // CLI entrypoint must execute (not silently exit 0) on non-ASCII workspace paths (`命定之诗`) and relative paths.
  assert.ok(verifyScript.includes("命定之诗"), "expected workspace path to exercise non-ASCII URL comparison");
  const cliOk = spawnSync(process.execPath, [verifyScript, "--tables", tables, "--r2", r2], { encoding: "utf8" });
  assert.equal(cliOk.status, 0, cliOk.stderr);
  assert.equal(JSON.parse(cliOk.stdout).ok, true);

  const relScript = relative(process.cwd(), verifyScript);
  const cliMissingArgs = spawnSync(process.execPath, [relScript], { encoding: "utf8" });
  assert.equal(cliMissingArgs.status, 2);

  // Basename root fallback must NOT mask a missing nested object key.
  await unlink(join(r2, "projects/p1/worldbook.json"));
  await writeFile(join(r2, "worldbook.json"), wbBody);
  const missingNested = verifyBackup(tables, r2);
  assert.equal(missingNested.ok, false);
  assert.ok(
    missingNested.failures.some((item) => item.kind === "missing_asset" && item.key === "projects/p1/worldbook.json"),
  );

  // Restore nested object with corrupt bytes -> sha256 failure, and CLI returns exit code 1!
  await writeFile(join(r2, "projects/p1/worldbook.json"), "corrupt");
  const corrupt = verifyBackup(tables, r2);
  assert.equal(corrupt.ok, false);
  assert.ok(corrupt.failures.some((item) => item.kind === "sha256"));
  const cliFail = spawnSync(process.execPath, [verifyScript, "--tables", tables, "--r2", r2], { encoding: "utf8" });
  assert.equal(cliFail.status, 1);
  assert.equal(JSON.parse(cliFail.stdout).ok, false);

  await writeFile(join(r2, "projects/p1/worldbook.json"), wbBody);

  // Cross-project version pointer and non-null version_id / wrong-kind cover pointer must fail!
  await writeFile(
    join(tables, "projects.json"),
    JSON.stringify([
      {
        id: "p1",
        published_version_id: "v-other",
        working_version_id: "missing",
        published_cover_asset_id: "a-wb",
      },
    ]),
  );
  const pointer = verifyBackup(tables, r2);
  assert.equal(pointer.ok, false);
  assert.deepEqual(
    pointer.failures.filter((item) => item.kind === "pointer").map((item) => item.field),
    ["published_version_id", "working_version_id", "published_cover_asset_id"],
  );

  console.log("backup verify tests passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
