#!/usr/bin/env node
/**
 * Load a migrated target JSON into an isolated local D1 database.
 * This is a rehearsal adapter only; it never targets a remote database.
 *
 * Usage:
 *   node tools/migrate/load-local.mjs --target /tmp/migration.json --persist-to /tmp/d1-state
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, TABLES } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const workerDir = path.join(root, 'apps/worker');

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
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

const SKIP_COLUMNS = new Set(['content_base64', 'entry_count', 'source_key']);

function insertSql(table, rows, chunk = 1) {
  if (rows.length === 0) return '';
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))]
    .filter(column => !SKIP_COLUMNS.has(column));
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
            (SELECT COUNT(*) FROM audit_events) AS audit,
            (SELECT COUNT(*) FROM projects p WHERE p.likes_count <> (SELECT COUNT(*) FROM project_likes l WHERE l.project_id = p.id)) AS like_mismatches,
            (SELECT COUNT(*) FROM projects p WHERE p.subscriptions_count <> (SELECT COUNT(*) FROM project_subscriptions s WHERE s.project_id = p.id)) AS subscription_mismatches`,
  ]);
  const parsed = JSON.parse(output);
  const row = parsed[0]?.results?.[0];
  if (!row || row.like_mismatches !== 0 || row.subscription_mismatches !== 0) {
    throw new Error(`loaded counter mismatch: ${output}`);
  }
  return parsed;
}

const targetPath = arg('target');
const persistTo = path.resolve(arg('persist-to', path.join(os.tmpdir(), 'workshop-d1-load')));
if (!targetPath) {
  console.error('--target is required');
  process.exit(2);
}
const target = await readJson(targetPath);
if (
  persistTo === path.parse(persistTo).root
  || persistTo === process.cwd()
  || persistTo === os.homedir()
  || root === persistTo
  || root.startsWith(`${persistTo}${path.sep}`)
) {
  throw new Error(`refusing to delete unsafe --persist-to path: ${persistTo}`);
}
if (existsSync(persistTo) && !existsSync(path.join(persistTo, 'v3', 'd1'))) {
  throw new Error(`refusing to delete a non-wrangler --persist-to directory: ${persistTo}`);
}
const tmp = mkdtempSync(path.join(os.tmpdir(), 'workshop-load-'));
try {
  rmSync(persistTo, { recursive: true, force: true });
  wrangler(['d1', 'migrations', 'apply', 'workshop-staging', '--local', '--persist-to', persistTo, '--config', 'wrangler.jsonc']);
  for (const table of TABLES) {
    const rows = (target.tables?.[table] ?? []).map(row => table === 'projects'
      ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'likes_count' && key !== 'subscriptions_count'))
      : row);
    const sql = insertSql(table, rows);
    if (!sql) continue;
    const file = path.join(tmp, `${table}.sql`);
    writeFileSync(file, sql);
    wrangler(['d1', 'execute', 'workshop-staging', '--local', '--persist-to', persistTo, '--config', 'wrangler.jsonc', '--file', file]);
  }
  console.log(JSON.stringify({ ok: true, persistTo, counts: count(persistTo) }));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
