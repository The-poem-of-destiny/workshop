#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { verifyBackup } from './verify.mjs';

const dir = await mkdtemp(join(os.tmpdir(), 'workshop-backup-'));
try {
  const tables = join(dir, 'tables');
  const r2 = join(dir, 'r2');
  await mkdir(tables, { recursive: true });
  await mkdir(join(r2, 'projects/p1'), { recursive: true });
  const body = Buffer.from('{"entries":[]}');
  const sha256 = createHash('sha256').update(body).digest('hex');
  await writeFile(join(r2, 'projects/p1/worldbook.json'), body);
  await writeFile(join(tables, 'assets.json'), JSON.stringify([{ id: 'a1', r2_key: 'projects/p1/worldbook.json', sha256, bytes: body.length }]));
  await writeFile(join(tables, 'project_revisions.json'), JSON.stringify([{ id: 'r1', project_id: 'p1' }]));
  await writeFile(join(tables, 'projects.json'), JSON.stringify([{ id: 'p1', published_revision_id: 'r1', working_revision_id: 'r1' }]));
  assert.equal(verifyBackup(tables, r2).ok, true);

  await writeFile(join(r2, 'projects/p1/worldbook.json'), 'corrupt');
  const corrupt = verifyBackup(tables, r2);
  assert.equal(corrupt.ok, false);
  assert.ok(corrupt.failures.some(item => item.kind === 'sha256'));

  await writeFile(join(tables, 'projects.json'), JSON.stringify([{ id: 'p1', published_revision_id: 'missing' }]));
  const pointer = verifyBackup(tables, r2);
  assert.ok(pointer.failures.some(item => item.kind === 'pointer'));
  console.log('backup verify tests passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
