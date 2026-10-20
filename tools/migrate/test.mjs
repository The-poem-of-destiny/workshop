#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract, transform, verify, reconcile, stableStringify } from './lib.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'workshop-migration-'));
try {
  await mkdir(path.join(dir, 'source'));
  const source = path.join(dir, 'source');
  const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs');
  const help = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, '--help exits successfully');
  assert.match(help.stdout, /Usage: node tools\/migrate\/cli\.mjs/);
  const missing = spawnSync(process.execPath, [cliPath, 'all', '--source', '/nonexistent', '--target', path.join(dir, 'missing-target.json')], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0, 'a nonexistent source exits non-zero');
  assert.match(missing.stderr, /migration:/);
  await writeFile(path.join(source, 'users.json'), JSON.stringify([
    { id: 'u1', username: 'author', role: 'member', created_at: '2024-01-01T00:00:00Z' },
    { id: 'u2', username: 'reviewer', is_admin: true }
  ]));
  await writeFile(path.join(source, 'projects.json'), JSON.stringify([
    { id: 'pub-1', root_project_id: 'root-1', title: 'One', status: 'approved', visibility: 1, author_id: 'u1', updated_at: '2024-01-02T00:00:00Z' },
    { id: 'draft-1', root_project_id: 'root-1', title: 'One draft', status: 'draft', author_id: 'u1', updated_at: '2024-01-03T00:00:00Z' },
    { id: 'rej-1', root_project_id: 'root-1', title: 'One rejected', status: 'rejected', author_id: 'u1', updated_at: '2024-01-04T00:00:00Z' },
    { id: 'rej-0', root_project_id: 'root-1', title: 'Older rejected', status: 'rejected', author_id: 'u1', updated_at: '2023-12-01T00:00:00Z' }
  ]));
  await writeFile(path.join(source, 'assets.json'), JSON.stringify([
    { id: 'asset-1', project_id: 'pub-1', kind: 'cover', sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', bytes: 3, mime: 'image/png' },
    { id: 'asset-2', project_id: 'pub-1', kind: 'worldbook', sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', bytes: 4, mime: 'application/json' }
  ]));
  await writeFile(path.join(source, 'project_likes.json'), JSON.stringify([{ project_id: 'pub-1', user_id: 'u2' }]));
  await writeFile(path.join(source, 'submissions.json'), JSON.stringify([{ id: 'submission-1', project_id: 'pub-1', revision_id: 'draft-1', status: 'pending', submitted_by: 'u1' }]));
  await writeFile(path.join(source, 'reviews.json'), JSON.stringify([{ id: 'review-1', submission_id: 'submission-1', reviewer_id: 'u2', decision: 'approve' }]));
  await writeFile(path.join(source, 'audit_events.json'), JSON.stringify([{ id: 'audit-1', actor_id: 'u2', action: 'review.approve', target_id: 'submission-1' }]));

  const firstRun = transform(await extract(source));
  const secondRun = transform(await extract(source));
  assert.equal(stableStringify(firstRun), stableStringify(secondRun), 'same source must produce byte-stable output');
  assert.equal(firstRun.tables.projects.length, 1, 'published and draft rows form one public project');
  assert.equal(firstRun.tables.projects[0].id, 'pub-1', 'published project id is retained');
  assert.equal(firstRun.tables.project_likes.length, 1);
  assert.equal(firstRun.tables.assets[0].sha256.length, 64);
  const draftRevision = firstRun.tables.project_revisions.find(revision => revision.id.includes('draft-1'));
  assert.equal(firstRun.tables.projects[0].working_revision_id, draftRevision.id, 'working pointer follows the current draft');
  const rejected = firstRun.tables.project_revisions.filter(revision => revision.id.includes('rej-'));
  assert.equal(rejected.length, 1, 'only one rejected revision is retained');
  assert.equal(rejected[0].id.includes('rej-1'), true, 'the newest rejected revision is retained');
  assert.equal(firstRun.tables.submissions[0].submitted_by, 'u1', 'submitter id is preserved');
  assert.equal(firstRun.tables.reviews[0].reviewer_id, 'u2', 'reviewer id is preserved');
  assert.equal(firstRun.tables.audit_events[0].actor_id, 'u2', 'audit actor is preserved');
  assert.equal(firstRun.tables.users.some(user => user.id === 'audit-1'), false, 'audit event id does not create a phantom user');
  assert.equal(verify(firstRun).ok, true);

  const lostPointer = structuredClone(firstRun);
  lostPointer.tables.projects[0].published_revision_id = null;
  assert.equal(verify(lostPointer).ok, false, 'lost published pointer is detected');

  const changed = structuredClone(firstRun);
  changed.tables.assets[0].sha256 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  assert.equal(verify(changed).ok, false, 'asset mismatch is detected');

  const duplicateKey = structuredClone(firstRun);
  duplicateKey.tables.assets[1].r2_key = duplicateKey.tables.assets[0].r2_key;
  assert.equal(verify(duplicateKey).ok, false, 'duplicate asset r2 keys are rejected');
  assert.equal(reconcile(firstRun, changed).ok, false, 'reconcile reports target mismatch');

  const delta = transform(await extract(source, { since: '2024-01-03T00:00:00Z' }));
  assert.equal(delta.tables.projects[0].id, firstRun.tables.projects[0].id, 'delta retains published project identity');
  assert.equal(delta.tables.projects[0].published_revision_id, firstRun.tables.projects[0].published_revision_id, 'delta retains published pointer');
  assert.equal(verify(delta).ok, true, 'delta output verifies');
  console.log('migration tests passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
