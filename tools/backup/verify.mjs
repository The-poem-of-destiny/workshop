#!/usr/bin/env node
/**
 * Verify a backup export without touching the live database.
 * Usage: node tools/backup/verify.mjs --tables <dir> --r2 <dir>
 *
 * The export layout is the same per-table JSON produced by
 * tools/migrate/from_d1_sql.py: assets.json, projects.json,
 * project_revisions.json. Every asset row must have matching bytes and sha256
 * in the R2 mirror; project pointers must stay within the same project.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function readTable(dir, name) {
  const file = join(dir, `${name}.json`);
  if (!existsSync(file)) return [];
  return rows(JSON.parse(readFileSync(file, 'utf8')));
}

export function verifyBackup(tablesDir, r2Dir) {
  const tables = resolve(tablesDir);
  const r2 = resolve(r2Dir);
  const assets = readTable(tables, 'assets');
  const projects = readTable(tables, 'projects');
  const revisions = readTable(tables, 'project_revisions');
  const failures = [];
  let checked = 0;

  const revisionsByKey = new Map();
  for (const revision of revisions) {
    const key = `${revision.project_id}:${revision.id}`;
    revisionsByKey.set(key, revision);
  }

  for (const project of projects) {
    for (const field of ['published_revision_id', 'working_revision_id']) {
      const revisionId = project[field];
      if (!revisionId) continue;
      const ok = revisionsByKey.has(`${project.id}:${revisionId}`);
      if (!ok) failures.push({ kind: 'pointer', project: project.id, field, revisionId });
    }
  }

  for (const asset of assets) {
    const key = asset.r2_key ?? asset.targetKey ?? asset.key;
    if (typeof key !== 'string' || !key) {
      failures.push({ kind: 'asset_key', asset: asset.id ?? null });
      continue;
    }
    checked += 1;
    const path = join(r2, key);
    const fallback = join(r2, basename(key));
    const chosen = existsSync(path) ? path : existsSync(fallback) ? fallback : null;
    if (!chosen) {
      failures.push({ kind: 'missing_asset', key });
      continue;
    }
    const body = readFileSync(chosen);
    const actualSha = createHash('sha256').update(body).digest('hex');
    if (asset.sha256 && actualSha !== asset.sha256) {
      failures.push({ kind: 'sha256', key, expected: asset.sha256, actual: actualSha });
    }
    if (asset.bytes != null && statSync(chosen).size !== Number(asset.bytes)) {
      failures.push({ kind: 'bytes', key, expected: Number(asset.bytes), actual: statSync(chosen).size });
    }
  }

  return {
    ok: failures.length === 0,
    checked: { assets: checked, projects: projects.length, revisions: revisions.length },
    failures,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tables = arg('tables');
  const r2 = arg('r2');
  if (!tables || !r2) {
    console.error('Usage: node tools/backup/verify.mjs --tables <dir> --r2 <dir>');
    process.exit(2);
  }
  const report = verifyBackup(tables, r2);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
