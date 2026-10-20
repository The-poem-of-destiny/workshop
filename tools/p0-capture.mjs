#!/usr/bin/env node
/**
 * Capture public, unauthenticated legacy API responses as P0 fixtures.
 *
 * Usage:
 *   LEGACY_BASE_URL=https://... node tools/p0-capture.mjs
 *
 * The output is intentionally limited to public read endpoints and contains
 * no credentials. Do not add authenticated requests or private project data.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const base = (process.env.LEGACY_BASE_URL ?? 'https://poemofdestinycreativeworkshop.1528779666.workers.dev').replace(/\/$/, '');
const outDir = process.env.P0_OUT_DIR ?? 'tests/fixtures/legacy';
const capturedAt = new Date().toISOString();

const requests = [
  ['projects-default', '/api/projects'],
  ['projects-page-1', '/api/projects?page=1&pageSize=20'],
  ['projects-downloads', '/api/projects?sort=downloads&pageSize=5'],
  ['projects-updated', '/api/projects?sort=updated&pageSize=5'],
  ['projects-search', '/api/projects?search=%E5%91%BD%E5%AE%9A&pageSize=5'],
  ['projects-type-core', '/api/projects?projectType=%E7%B3%BB%E7%BB%9F%E6%A0%B8%E5%BF%83&pageSize=5'],
  ['discover-banner', '/api/site/discover-banner'],
  ['recommendations', '/api/devteam-recommendations'],
  ['character-references', '/api/character-references'],
];

const manifest = {
  base,
  capturedAt,
  note: 'Anonymous public reads only. Product semantics oracle; never a security/cache oracle.',
  entries: [],
};

async function capture(name, path) {
  const url = `${base}${path}`;
  const bodyPath = join(tmpdir(), `p0-${process.pid}-${name}.body`);
  const headerPath = join(tmpdir(), `p0-${process.pid}-${name}.headers`);
  // Node fetch ignores an ambient HTTP proxy; curl uses it and is available in
  // the dev/CI environments this script targets.
  execFileSync('curl', [
    '-sS', '-m', '30', '-D', headerPath, '-o', bodyPath,
    '-H', 'accept: application/json', url,
  ]);
  const text = await readFile(bodyPath, 'utf8');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 20_000) };
  }
  const rawHeaders = await readFile(headerPath, 'utf8');
  const statusLine = rawHeaders.split('\n').find(line => line.startsWith('HTTP/')) ?? '';
  const status = Number(statusLine.split(' ')[1] ?? 0);
  const headers = {};
  for (const key of ['content-type', 'cache-control', 'vary', 'access-control-allow-origin']) {
    const line = rawHeaders
      .split('\n')
      .find(value => value.toLowerCase().startsWith(`${key}:`));
    if (line) headers[key] = line.slice(line.indexOf(':') + 1).trim();
  }
  await writeFile(join(outDir, `${name}.json`), JSON.stringify(body, null, 2) + '\n');
  manifest.entries.push({ name, path, status, headers });
  return body;
}

await mkdir(outDir, { recursive: true });

const list = await capture('projects-default', '/api/projects');
const projectIds = Array.isArray(list?.projects)
  ? list.projects.slice(0, 3).map(project => project.id).filter(Boolean)
  : [];

for (const [index, projectId] of projectIds.entries()) {
  const suffix = `project-${index + 1}`;
  await capture(`${suffix}-detail`, `/api/projects/${encodeURIComponent(projectId)}`);
  await capture(`${suffix}-install-info`, `/api/projects/${encodeURIComponent(projectId)}/install-info`);
}

for (const [name, path] of requests.slice(1)) {
  await capture(name, path);
}

const references = JSON.parse(execFileSync('curl', ['-sS', '-m', '30', `${base}/api/character-references`], { encoding: 'utf8' }));
const versionId = references?.references?.[0]?.versions?.[0]?.id;
if (versionId) {
  await capture('reference-items', `/api/character-references/versions/${encodeURIComponent(versionId)}/items?pageSize=5`);
}

await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Captured ${manifest.entries.length} public responses into ${outDir}`);
