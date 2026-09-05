import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function readExportExpression(relativePath, exportName) {
  const source = await readFile(resolve(relativePath), 'utf8');
  const marker = `export const ${exportName} = `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${exportName} in ${relativePath}`);
  const raw = source.slice(start + marker.length).trim();
  const expression = raw.endsWith(';') ? raw.slice(0, -1) : raw;
  return expression;
}

async function evaluateStandalone(relativePath, exportName) {
  const expression = await readExportExpression(relativePath, exportName);
  return Function(`return (${expression});`)();
}

const fragments = {
  homeStateScript: await evaluateStandalone('src/pages/home/state.ts', 'homeStateScript'),
  homeUtilsScript: await evaluateStandalone('src/pages/home/utils.ts', 'homeUtilsScript'),
  homeTavernBridgeScript: await evaluateStandalone('src/pages/home/tavern-bridge.ts', 'homeTavernBridgeScript'),
  homeApiScript: await evaluateStandalone('src/pages/home/api.ts', 'homeApiScript'),
  homeCardsRenderScript: await evaluateStandalone('src/pages/home/render/cards.ts', 'homeCardsRenderScript'),
  homeDetailModalRenderScript: await evaluateStandalone('src/pages/home/render/detail-modal.ts', 'homeDetailModalRenderScript'),
  homeLayoutRenderScript: await evaluateStandalone('src/pages/home/render/layout.ts', 'homeLayoutRenderScript'),
  homeModalsScript: await evaluateStandalone('src/pages/home/modals.ts', 'homeModalsScript'),
};

for (const [name, script] of Object.entries(fragments)) {
  assert.equal(typeof script, 'string', `${name} must evaluate to JavaScript text`);
  new Function(script);
}

assert.match(fragments.homeModalsScript, /id=\"versionLabel\"/);
assert.match(fragments.homeModalsScript, /版本名称（可选）/);
assert.doesNotMatch(fragments.homeModalsScript, /versionBump|Patch|Minor|Major/);
assert.match(fragments.homeCardsRenderScript, /撤回更新/);
assert.match(fragments.homeCardsRenderScript, /delete-project-btn/);
assert.match(fragments.homeCardsRenderScript, /role=\"button\" tabindex=\"0\"/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /detail-btn/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /审核中的项目暂不可删除/);

const projectFormUi = Function(
  `${fragments.homeUtilsScript}\n${fragments.homeModalsScript}; return { buildProjectFormHtml };`,
)();
const createProjectFormHtml = projectFormUi.buildProjectFormHtml('create');
assert.match(createProjectFormHtml, /id="projectForm"/);
assert.match(createProjectFormHtml, /id="fileInput"/);
assert.match(createProjectFormHtml, /id="versionLabel"/);

const versionState = { tavern: { clientVersion: null, clientVersionResolved: false } };
const workshopVersionUi = Function(
  'state',
  `${fragments.homeUtilsScript}; return { parseWorkshopVersion, compareWorkshopVersions, shouldShowWorkshopReleaseNotice };`,
)(versionState);
assert.deepEqual(workshopVersionUi.parseWorkshopVersion('2.0.13'), [2, 0, 13]);
assert.deepEqual(workshopVersionUi.parseWorkshopVersion('v2.0.13'), [2, 0, 13]);
assert.equal(workshopVersionUi.parseWorkshopVersion('2.0'), null);
assert.equal(workshopVersionUi.parseWorkshopVersion('latest'), null);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.12', '2.0.13'), -1);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.13', '2.0.13'), 0);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.14', '2.0.13'), 1);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.9', '2.0.12'), -1);
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), false);
versionState.tavern.clientVersionResolved = true;
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), true);
versionState.tavern.clientVersion = '2.0.12';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), true);
versionState.tavern.clientVersion = '2.0.13';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), false);
versionState.tavern.clientVersion = '2.0.14';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), false);
versionState.tavern.clientVersion = 'not-a-version';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), true);
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('broken-release'), false);

const dateUi = Function(`${fragments.homeUtilsScript}; return { getProjectPublishedAt };`)();
assert.equal(dateUi.getProjectPublishedAt({ latestApprovedAt: '2026-09-04', reviewedAt: '2026-09-03', createdAt: '2026-09-02' }), '2026-09-04');
assert.equal(dateUi.getProjectPublishedAt({ reviewedAt: '2026-09-03', createdAt: '2026-09-02' }), '2026-09-02');
assert.equal(dateUi.getProjectPublishedAt({ createdAt: '2026-09-02' }), '2026-09-02');

const appSource = await readFile(resolve('src/pages/home/app.ts'), 'utf8');
const withoutImports = appSource.replace(/^import .*;\r?\n/gm, '');
const marker = 'export const homeScript = ';
const start = withoutImports.indexOf(marker);
assert.notEqual(start, -1, 'Missing homeScript export');
const rawAppExpression = withoutImports.slice(start + marker.length).trim();
const appExpression = rawAppExpression.endsWith(';') ? rawAppExpression.slice(0, -1) : rawAppExpression;
const fragmentNames = Object.keys(fragments);
const homeScript = Function(...fragmentNames, `return (${appExpression});`)(...Object.values(fragments));
assert.equal(typeof homeScript, 'string');
new Function(homeScript);
assert.match(homeScript, /reviewProject\(projectId, \{ action, expectedRevision: project\?\.draftRevision \}\)/);
assert.match(homeScript, /reviewProject\(projectId, \{ action, rejectReason: reason, expectedRevision: project\?\.draftRevision \}\)/);
assert.match(homeScript, /确定撤回这次更新吗/);
assert.match(homeScript, /正在审核\/被退回的更新草稿也会一并删除/);
assert.match(homeScript, /document\.querySelectorAll\('\.project-card'\)/);
assert.match(homeScript, /document\.querySelectorAll\('\.delete-project-btn'\)/);
assert.doesNotMatch(homeScript, /document\.querySelectorAll\('\.detail-btn'\)/);

console.log('assembled /assets/home.js syntax smoke: ok');
