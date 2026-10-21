#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract, transform, verify, reconcile, stableStringify } from './lib.mjs';
import { createHash } from 'node:crypto';
import { buildManifest, localCopy, validateManifest } from './r2-copy.mjs';

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
    { id: 'asset-2', project_id: 'pub-1', kind: 'worldbook', sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', bytes: 4, entry_count: 10, mime: 'application/json' }
  ]));
  await writeFile(path.join(source, 'project_likes.json'), JSON.stringify([{ project_id: 'pub-1', user_id: 'u2' }]));
  await writeFile(path.join(source, 'submissions.json'), JSON.stringify([{ id: 'submission-1', project_id: 'pub-1', revision_id: 'draft-1', status: 'pending', submitted_by: 'u1' }]));
  await writeFile(path.join(source, 'reviews.json'), JSON.stringify([{ id: 'review-1', submission_id: 'submission-1', reviewer_id: 'u2', decision: 'approve' }]));
  await writeFile(path.join(source, 'audit_events.json'), JSON.stringify([{ id: 'audit-1', actor_id: 'u2', action: 'review.approve', target_id: 'submission-1' }]));
  await writeFile(path.join(source, 'site_settings.json'), JSON.stringify([{ key: 'banner', value: '{"imageUrl":null}' }]));
  await writeFile(path.join(source, 'project_metrics_daily.json'), JSON.stringify([{ day_key: '2024-01-02', project_id: 'pub-1', downloads: 2, likes_delta: 1 }]));
  await writeFile(path.join(source, 'ranking_runs.json'), JSON.stringify([{ id: 'run-1', kind: 'daily', bucket: '2024-01-02T00' }]));
  await writeFile(path.join(source, 'ranking_entries.json'), JSON.stringify([{ run_id: 'run-1', rank: 1, project_id: 'pub-1', score: 5 }]));
  await writeFile(path.join(source, 'discovery_exposures.json'), JSON.stringify([{ bucket: '2024-01-02T00', project_id: 'pub-1', rank: 1 }]));

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
  assert.equal(firstRun.tables.site_settings[0].key, 'banner');
  assert.equal(firstRun.tables.project_metrics_daily[0].project_id, 'pub-1');
  assert.equal(firstRun.tables.ranking_runs[0].kind, 'daily');
  assert.equal(firstRun.tables.ranking_entries[0].project_id, 'pub-1');
  assert.equal(firstRun.tables.discovery_exposures[0].project_id, 'pub-1');
  assert.equal(firstRun.meta.droppedTables.length, 0, 'supported source tables are mapped, not dropped');
  assert.equal(firstRun.tables.users.some(user => user.id === 'audit-1'), false, 'audit event id does not create a phantom user');
  assert.equal(verify(firstRun).ok, true);

  const lostPointer = structuredClone(firstRun);
  lostPointer.tables.projects[0].published_revision_id = null;
  assert.equal(verify(lostPointer).ok, false, 'lost published pointer is detected');

  const changed = structuredClone(firstRun);
  changed.tables.assets[0].sha256 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  assert.equal(verify(changed).ok, false, 'asset mismatch is detected');

  const crossPointer = structuredClone(firstRun);
  crossPointer.tables.project_revisions.push({
    ...crossPointer.tables.project_revisions[0], id: 'other-revision', project_id: 'other-project',
  });
  crossPointer.tables.projects[0].published_revision_id = 'other-revision';
  const crossReport = verify(crossPointer);
  assert.equal(crossReport.ok, false, 'cross-project published pointer is rejected');
  assert.ok(crossReport.mismatches.some(item => item.check === 'pointer_owner'));

  const emptyRelease = structuredClone(firstRun);
  const publishedRevision = emptyRelease.tables.project_revisions.find(
    revision => revision.id === emptyRelease.tables.projects[0].published_revision_id,
  );
  publishedRevision.worldbook_count = 0;
  publishedRevision.regex_count = 0;
  assert.ok(verify(emptyRelease).mismatches.some(item => item.check === 'published_empty_content'));

  const duplicateKey = structuredClone(firstRun);
  duplicateKey.tables.assets[1].r2_key = duplicateKey.tables.assets[0].r2_key;
  assert.equal(verify(duplicateKey).ok, false, 'duplicate asset r2 keys are rejected');
  assert.equal(reconcile(firstRun, changed).ok, false, 'reconcile reports target mismatch');

  const manifest = buildManifest(firstRun);
  assert.equal(manifest.objects.length, firstRun.tables.assets.length, 'every asset needs a copy manifest entry');
  assert.equal(validateManifest(manifest), manifest);
  assert.throws(() => validateManifest({ objects: [{ sourceKey: 'a', targetKey: 'b', sha256: 'x', bytes: 1 }] }), /sha256/);
  assert.throws(() => validateManifest({ objects: [
    { sourceKey: 'a', targetKey: 'b', sha256: 'a'.repeat(64), bytes: 1 },
    { sourceKey: 'c', targetKey: 'b', sha256: 'b'.repeat(64), bytes: 1 },
  ] }), /duplicate targetKey/);

  const copyRoot = path.join(dir, 'r2');
  const copySource = path.join(copyRoot, 'source');
  const copyTarget = path.join(copyRoot, 'target');
  await mkdir(path.join(copySource, 'nested'), { recursive: true });
  const payload = Buffer.from('asset-bytes');
  await writeFile(path.join(copySource, 'nested', 'asset.json'), payload);
  const copyManifest = validateManifest({ objects: [{
    sourceKey: 'nested/asset.json', targetKey: 'projects/p1/asset.json',
    sha256: createHash('sha256').update(payload).digest('hex'), bytes: payload.length,
  }] });
  assert.equal(localCopy(copyManifest, copySource, copyTarget).length, 1);
  assert.equal(localCopy(copyManifest, copySource, copyTarget).length, 0, 'second copy is idempotent');
  await writeFile(path.join(copyTarget, 'projects/p1/asset.json'), 'corrupt');
  assert.equal(localCopy(copyManifest, copySource, copyTarget).length, 1, 'corrupt target is repaired');
  assert.equal((await readFile(path.join(copyTarget, 'projects/p1/asset.json'))).toString(), 'asset-bytes');

  const delta = transform(await extract(source, { since: '2024-01-03T00:00:00Z' }));
  assert.equal(delta.tables.projects[0].id, firstRun.tables.projects[0].id, 'delta retains published project identity');
  assert.equal(delta.tables.projects[0].published_revision_id, firstRun.tables.projects[0].published_revision_id, 'delta retains published pointer');
  assert.equal(verify(delta).ok, true, `delta output verifies: ${JSON.stringify(verify(delta).mismatches)}`);
  console.log('migration tests passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
