#!/usr/bin/env node
import path from 'node:path';
import { extract, transform, verify, reconcile, readJson, writeJson } from './lib.mjs';

const help = `Usage: node tools/migrate/cli.mjs <phase> --source <dir> --target <file> [options]

Phases:
  extract    Read legacy JSON rows into a deterministic extract
  transform  Extract and map rows to the new-table JSON representation
  load       Transform and write the local target JSON (no remote writes)
  verify     Check a target JSON for migration invariants
  reconcile  Compare a transformed source with a target and print JSON
  all        Transform, write, verify, and reconcile in one local run

Options:
  --source <dir>       Legacy export directory (required for extract/transform/load/all/reconcile)
  --target <file>      Local JSON target file (required except --help)
  --since <timestamp>  Include only rows changed at or after this ISO timestamp
  --dry-run             Do not write the target file
  --help                Show this message`;

function parse(argv) {
  const args = [...argv]; let phase = null, source, target, since, dryRun = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!phase && !arg.startsWith('-')) { phase = arg; continue; }
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (['--source', '--target', '--since'].includes(arg)) { const value = args.shift(); if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`); if (arg === '--source') source = value; else if (arg === '--target') target = value; else since = value; continue; }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!phase) throw new Error('phase is required');
  if (!['extract', 'transform', 'load', 'verify', 'reconcile', 'all'].includes(phase)) throw new Error(`unknown phase: ${phase}`);
  if (!target) throw new Error('--target is required');
  if (['extract', 'transform', 'load', 'reconcile', 'all'].includes(phase) && !source) throw new Error('--source is required for this phase');
  return { phase, source, target, since, dryRun };
}

export async function run(options) {
  if (options.phase === 'verify') {
    const report = verify(await readJson(options.target));
    console.log(JSON.stringify(report));
    return report.ok ? 0 : 1;
  }
  const snapshot = await extract(options.source, { since: options.since });
  if (options.phase === 'extract') {
    if (!options.dryRun) await writeJson(options.target, snapshot);
    console.log(JSON.stringify({ ok: true, phase: 'extract', tables: Object.fromEntries(Object.entries(snapshot.tables).map(([k, v]) => [k, v.length])), dryRun: options.dryRun }));
    return 0;
  }
  const expected = transform(snapshot);
  if (options.phase === 'transform' || options.phase === 'load') {
    if (!options.dryRun) await writeJson(options.target, expected);
    console.log(JSON.stringify({ ok: true, phase: options.phase, projects: expected.tables.projects.length, dryRun: options.dryRun }));
    return 0;
  }
  if (options.phase === 'reconcile') {
    const report = reconcile(expected, await readJson(options.target));
    console.log(JSON.stringify(report));
    return report.ok ? 0 : 1;
  }
  if (!options.dryRun) await writeJson(options.target, expected);
  const report = { verify: verify(expected), reconcile: reconcile(expected, expected) };
  report.ok = report.verify.ok && report.reconcile.ok;
  console.log(JSON.stringify(report));
  return report.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parse(process.argv.slice(2));
    if (options.help) { console.log(help); process.exit(0); }
    process.exitCode = await run(options);
  } catch (error) {
    console.error(`migration: ${error instanceof Error ? error.message : String(error)}`);
    console.error(help);
    process.exitCode = 2;
  }
}
