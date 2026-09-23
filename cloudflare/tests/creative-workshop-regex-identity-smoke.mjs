import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

async function compile(relativePath) {
  const source = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadCommonJs(compiled, context, filename) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, { ...context, module, exports: module.exports }, { filename });
  return module.exports;
}

const identityApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/install-identity.ts'),
  { JSON, String, Number, Object, Array, Error },
  'install-identity.ts',
);

const regexNameApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/regex-name.ts'),
  {
    require(specifier) {
      if (specifier === './install-identity') return identityApi;
      throw new Error(`Unexpected require: ${specifier}`);
    },
  },
  'regex-name.ts',
);

assert.equal(regexNameApi.getCreativeWorkshopRegexEntryKey({ id: 'abc' }, 0), 'id:abc');
assert.equal(regexNameApi.getCreativeWorkshopRegexEntryKey({ id: 0 }, 5), 'id:0');
assert.equal(regexNameApi.getCreativeWorkshopRegexEntryKey({}, 2), 'index:2');

const generatedId = regexNameApi.getCreativeWorkshopManagedRegexId('project-1', { id: 'abc' }, 0, '1.2.3');
assert.equal(generatedId, 'creative_workshop:project-1:v1:id%3Aabc:1.2.3');
assert.deepEqual(
  JSON.parse(JSON.stringify(regexNameApi.getCreativeWorkshopRegexIdentity({ id: generatedId }))),
  { schemaVersion: 1, projectId: 'project-1', entryKey: 'id:abc', installedVersion: '1.2.3' },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(regexNameApi.getCreativeWorkshopRegexIdentity({
    id: 'creative_workshop:project-1:id:abc',
  }))),
  { schemaVersion: 0, projectId: 'project-1', entryKey: 'id:abc', installedVersion: null },
  'legacy 2.1.x regex ids must remain readable',
);

const projectId = 'project-1';
const detail = {
  project: { id: projectId, name: 'w', version: '1.0.0' },
  worldbookEntriesPreview: [],
  regexEntriesPreview: [
    { id: 'abc', scriptName: 'R', findRegex: 'foo', replaceString: 'bar' },
  ],
};
const localRegexes = [
  {
    id: 'creative_workshop:project-1:id:abc',
    script_name: '[工坊] w - R',
    find_regex: 'foo',
    replace_string: 'bar',
  },
];
let scriptVariables = {};

const lodash = {
  get(value, path, fallback) {
    const result = String(path).split('.').reduce((current, key) => current == null ? undefined : current[key], value);
    return result === undefined ? fallback : result;
  },
  isObject: value => value !== null && typeof value === 'object',
  isString: value => typeof value === 'string',
  set(value, path, nextValue) {
    const keys = String(path).split('.');
    let current = value;
    for (const key of keys.slice(0, -1)) current = (current[key] ||= {});
    current[keys.at(-1)] = nextValue;
    return value;
  },
  pickBy: (value, predicate) => Object.fromEntries(Object.entries(value).filter(([, item]) => predicate(item))),
};

const diffApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/diff.ts'),
  {
    require(specifier) {
      if (specifier === './install-registry') return { resolveCreativeWorkshopInstallWorldbook: async () => null };
      if (specifier === './project-fetch') return { fetchCreativeWorkshopProjectDetail: async () => detail };
      if (specifier === './project-type') return { formatCreativeWorkshopEntryName: comment => comment };
      if (specifier === './install-identity') return identityApi;
      if (specifier === './regex-name') return regexNameApi;
      throw new Error(`Unexpected require: ${specifier}`);
    },
    console, Promise, Map, Set, Date, JSON,
    _: lodash,
    getVariables: () => scriptVariables,
    getScriptId: () => 'test-script',
    updateVariablesWith: updater => {
      scriptVariables = updater(scriptVariables);
      return scriptVariables;
    },
    getCharWorldbookNames: () => ({ primary: null }),
    getWorldbookNames: () => [],
    getWorldbook: async () => [],
    getTavernRegexes: () => localRegexes,
  },
  'diff.ts',
);

const result = await diffApi.getCreativeWorkshopProjectDiff(projectId, '1.0.0');
assert.equal(result.diff.added.regexEntries.length, 0, 'legacy local regex must match the new remote identity');
assert.equal(result.diff.removed.regexEntries.length, 0, 'legacy local regex must not appear removed');
assert.equal(result.diff.modified.regexEntries.length, 0, 'identity format/version metadata must not create a fake content diff');

console.log('CreativeWorkshop regex identity smoke: ok');
