#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extract, readJson, reconcile, transform, writeJson } from "./lib.mjs";
import { verify } from "./validation.mjs";

const help = `Usage: node tools/migrate/cli.mjs <phase> --source <dir> --target <file> [--dry-run]

Phases:
  extract    Read explicitly exported users.json, projects.json, and assets.json
  transform  Select and transform public published releases into a local target JSON
  verify     Check a local target JSON for release, asset, manifest, and index invariants
  reconcile  Compare a transformed source with a local target JSON
  all        Transform, write, verify, and reconcile locally

Options:
  --source <dir>   Explicit export directory (required except verify)
  --target <file>  Local JSON input or output (required)
  --dry-run        Do not write the target file
  --help           Show this message`;

function parse(argv) {
  const args = [...argv];
  let phase = null;
  let source;
  let target;
  let dryRun = false;
  while (args.length) {
    const argument = args.shift();
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--source") source = args.shift();
    else if (argument === "--target") target = args.shift();
    else if (argument === "--dry-run") dryRun = true;
    else if (!phase) phase = argument;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!phase) throw new Error("phase is required");
  if (!["extract", "transform", "verify", "reconcile", "all"].includes(phase))
    throw new Error(`unknown phase: ${phase}`);
  if (!target) throw new Error("--target is required");
  if (phase !== "verify" && !source) throw new Error("--source is required for this phase");
  return { phase, source, target, dryRun };
}

export async function run(options) {
  if (options.phase === "verify") {
    const report = verify(await readJson(options.target));
    console.log(JSON.stringify(report));
    return report.ok ? 0 : 1;
  }
  const snapshot = await extract(options.source);
  if (options.phase === "extract") {
    if (!options.dryRun) await writeJson(options.target, snapshot);
    console.log(JSON.stringify({ ok: true, phase: "extract", written: !options.dryRun }));
    return 0;
  }
  const expected = transform(snapshot);
  if (options.phase === "transform") {
    if (!options.dryRun) await writeJson(options.target, expected);
    console.log(
      JSON.stringify({ ok: true, phase: "transform", written: !options.dryRun, skipped: expected.meta.skipped }),
    );
    return 0;
  }
  if (options.phase === "reconcile") {
    const report = reconcile(expected, await readJson(options.target));
    console.log(JSON.stringify(report));
    return report.ok ? 0 : 1;
  }
  if (!options.dryRun) await writeJson(options.target, expected);
  const written = options.dryRun ? expected : await readJson(options.target);
  const report = { verify: verify(written), reconcile: reconcile(expected, written) };
  report.ok = report.verify.ok && report.reconcile.ok;
  console.log(JSON.stringify(report));
  return report.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parse(process.argv.slice(2));
    if (options.help) console.log(help);
    else process.exitCode = await run(options);
  } catch (error) {
    console.error(`migration: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
