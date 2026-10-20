#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extract, transform, verify, reconcile, stableStringify } from './lib.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'workshop-migration-'));
try {
  await mkdir(path.join(dir, 'source'));
  const source = path.join(dir, 'source');
  await writeFile(path.join(source, 'users.json'), JSON.stringify([
    { id: 'u1', username: 'author', role: 'member', created_at: '2024-01-01T00:00:00Z' },
    { id: 'u2', username: 'reviewer', is_admin: true }
  ]));
  await writeFile(path.join(source, 'projects.json'), JSON.stringify([
    { id: 'pub-1', root_project_id: 'root-1', title: 'One', status: 'approved', visibility: 1, author_id: 'u1', updated_at: '2024-01-02T00:00:00Z' },
    { id: 'draft-1', root_project_id: 'root-1', title: 'One draft', status: 'draft', author_id: 'u1', updated_at: '2024-01-03T00:00:00Z' }
  ]));
  await writeFile(path.join(source, 'assets.json'), JSON.stringify([{ id: 'asset-1', project_id: 'pub-1', kind: 'cover', sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', bytes: 3, mime: 'image/png' }]));
  await writeFile(path.join(source, 'project_likes.json'), JSON.stringify([{ project_id: 'pub-1', user_id: 'u2' }]));
  await writeFile(path.join(source, 'submissions.json'), JSON.stringify([{ id: 'submission-1', project_id: 'pub-1', revision_id: 'draft-1', status: 'pending', submitted_by: 'u1' }]));

  const firstRun = transform(await extract(source));
  const secondRun = transform(await extract(source));
  assert.equal(stableStringify(firstRun), stableStringify(secondRun), 'same source must produce byte-stable output');
  assert.equal(firstRun.tables.projects.length, 1, 'published and draft rows form one public project');
  assert.equal(firstRun.tables.projects[0].id, 'pub-1', 'published project id is retained');
  assert.equal(firstRun.tables.project_likes.length, 1);
  assert.equal(firstRun.tables.assets[0].sha256.length, 64);
  assert.equal(verify(firstRun).ok, true);

  const changed = structuredClone(firstRun);
  changed.tables.assets[0].sha256 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  assert.equal(verify(changed).ok, false, 'asset mismatch is detected');
  assert.equal(reconcile(firstRun, changed).ok, false, 'reconcile reports target mismatch');

  const delta = await extract(source, { since: '2024-01-03T00:00:00Z' });
  assert.equal(delta.tables.projects.length, 1, 'delta uses row timestamps');
  console.log('migration tests passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
