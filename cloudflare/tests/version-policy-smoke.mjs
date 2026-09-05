import assert from 'node:assert/strict';
import {
  bumpProjectVersion,
  bumpProjectVersionWithLegacyFallback,
  normalizeProjectVersionBase,
  parseProjectVersion,
} from '../src/utils/version.js';

assert.deepEqual(parseProjectVersion('1.4.7'), { major: 1, minor: 4, patch: 7 });
assert.deepEqual(parseProjectVersion('v2.0.3'), { major: 2, minor: 0, patch: 3 });
assert.equal(parseProjectVersion('1.4'), null);
assert.equal(parseProjectVersion('latest'), null);

assert.equal(bumpProjectVersion('1.4.7', 'patch'), '1.4.8');
assert.equal(bumpProjectVersion('1.4.7', 'minor'), '1.5.0');
assert.equal(bumpProjectVersion('1.4.7', 'major'), '2.0.0');
assert.throws(() => bumpProjectVersion('1.4', 'patch'), /Expected X\.Y\.Z/);
assert.throws(() => bumpProjectVersion('1.4.7', 'banana'), /Invalid project version bump/);

assert.equal(normalizeProjectVersionBase('v2.0.3'), '2.0.3');
assert.equal(normalizeProjectVersionBase('latest'), '1.0.0');
assert.equal(normalizeProjectVersionBase(''), '1.0.0');
assert.equal(bumpProjectVersionWithLegacyFallback('latest', 'patch'), '1.0.1');
assert.equal(bumpProjectVersionWithLegacyFallback('未知版本', 'minor'), '1.1.0');
assert.equal(bumpProjectVersionWithLegacyFallback('1.2', 'major'), '2.0.0');

// Workshop release policy is always automatic patch+1; creators no longer choose bump type.
assert.equal(bumpProjectVersionWithLegacyFallback('1.4.7', 'patch'), '1.4.8');
assert.equal(bumpProjectVersionWithLegacyFallback('latest', 'patch'), '1.0.1');
assert.equal(bumpProjectVersionWithLegacyFallback('未知版本', 'patch'), '1.0.1');

console.log('project version policy smoke: ok');
