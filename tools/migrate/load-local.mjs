#!/usr/bin/env node
/**
 * Load a migrated target JSON into an isolated local D1 database.
 * This is a rehearsal adapter only; it never targets a remote database.
 *
 * Usage:
 *   node tools/migrate/load-local.mjs --target /tmp/migration.json --persist-to /tmp/d1-state
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, TABLES } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const workerDir = path.join(root, 'apps/worker');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function wrangler(args) {
  const result = spawnSync(
    'pnpm',
    ['--filter', '@workshop/worker', 'exec', 'wrangler', ...args],
    { cwd: workerDir, encoding: 'utf8', env: { ...process.env, CI: '1' } },
  );
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'object') return sqlValue(JSON.stringify(value));
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertSql(table, rows, chunk = 1) {
  if (rows.length === 0) return '';
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const list = columns.map(column => `"${column}"`).join(', ');
  const statements = [];
  for (let offset = 0; offset < rows.length; offset += chunk) {
    const values = rows.slice(offset, offset + chunk)
      .map(row => `(${columns.map(column => sqlValue(row[column])).join(', ')})`)
      .join(',\n');
    statements.push(`INSERT OR REPLACE INTO "${table}" (${list}) VALUES\n${values};`);
  }
  return statements.join('\n');
}

function count(persistTo) {
  const output = wrangler([
    'd1', 'execute', 'workshop-staging', '--local', '--persist-to', persistTo,
    '--config', 'wrangler.jsonc', '--json', '--command',
    `SELECT (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM projects) AS projects,
            (SELECT COUNT(*) FROM project_revisions) AS revisions,
            (SELECT COUNT(*) FROM assets) AS assets,
            (SELECT COUNT(*) FROM project_likes) AS likes,
            (SELECT COUNT(*) FROM project_subscriptions) AS subscriptions,
            (SELECT COUNT(*) FROM audit_events) AS audit`,
  ]);
  return JSON.parse(output);
}

const targetPath = arg('target');
const persistTo = path.resolve(arg('persist-to', path.join(os.tmpdir(), 'workshop-d1-load')));
if (!targetPath) {
  console.error('--target is required');
  process.exit(2);
}
const tmp = mkdtempSync(path.join(os.tmpdir(), 'workshop-load-'));
try {
  rmSync(persistTo, { recursive: true, force: true });
  wrangler(['d1', 'migrations', 'apply', 'workshop-staging', '--local', '--persist-to', persistTo, '--config', 'wrangler.jsonc']);
  const target = await readJson(targetPath);
  for (const table of TABLES) {
    const sql = insertSql(table, target.tables?.[table] ?? []);
    if (!sql) continue;
    const file = path.join(tmp, `${table}.sql`);
    writeFileSync(file, sql);
    wrangler(['d1', 'execute', 'workshop-staging', '--local', '--persist-to', persistTo, '--config', 'wrangler.jsonc', '--file', file]);
  }
  console.log(JSON.stringify({ ok: true, persistTo, counts: count(persistTo) }));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
