#!/usr/bin/env node
/**
 * Apply a verified migration target to an isolated local D1 state directory.
 * This command has no remote flags and never contacts remote D1 or R2.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { insertSql, readJson } from "./lib.mjs";
import { verify } from "./validation.mjs";
import { TABLES } from "./values.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const workerDir = path.join(root, "apps/worker");

function arg(name, fallback) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function wrangler(args) {
  const result = spawnSync("pnpm", ["--filter", "@workshop/worker", "exec", "wrangler", ...args], {
    cwd: workerDir,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  });
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

const targetPath = arg("target");
const persistTo = path.resolve(arg("persist-to", path.join(os.tmpdir(), "workshop-d1-load")));
if (!targetPath) {
  console.error("--target is required");
  process.exit(2);
}
const target = await readJson(targetPath);
const report = verify(target);
if (!report.ok) throw new Error(`target failed verification: ${JSON.stringify(report.mismatches)}`);
if (
  persistTo === path.parse(persistTo).root ||
  persistTo === process.cwd() ||
  persistTo === os.homedir() ||
  root === persistTo ||
  root.startsWith(`${persistTo}${path.sep}`)
) {
  throw new Error(`refusing to delete unsafe --persist-to path: ${persistTo}`);
}
if (existsSync(persistTo) && !existsSync(path.join(persistTo, "v3", "d1")))
  throw new Error(`refusing to delete a non-wrangler --persist-to directory: ${persistTo}`);
const tmp = mkdtempSync(path.join(os.tmpdir(), "workshop-load-"));
try {
  rmSync(persistTo, { recursive: true, force: true });
  wrangler([
    "d1",
    "migrations",
    "apply",
    "workshop-staging",
    "--local",
    "--persist-to",
    persistTo,
    "--config",
    "wrangler.jsonc",
  ]);
  for (const table of TABLES) {
    const sql = insertSql(table, target.tables[table]);
    if (!sql) continue;
    const file = path.join(tmp, `${table}.sql`);
    writeFileSync(file, sql);
    wrangler([
      "d1",
      "execute",
      "workshop-staging",
      "--local",
      "--persist-to",
      persistTo,
      "--config",
      "wrangler.jsonc",
      "--file",
      file,
    ]);
  }
  console.log(
    JSON.stringify({
      ok: true,
      persistTo,
      tables: Object.fromEntries(TABLES.map((name) => [name, target.tables[name].length])),
    }),
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
