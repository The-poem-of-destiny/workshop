import assert from 'node:assert/strict';
import {
  bumpProjectVersion,
  classifyProjectVersionTransition,
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

assert.equal(classifyProjectVersionTransition('1.4.7', '1.4.8'), 'patch');
assert.equal(classifyProjectVersionTransition('1.4.7', '1.5.0'), 'minor');
assert.equal(classifyProjectVersionTransition('1.4.7', '2.0.0'), 'major');
assert.equal(classifyProjectVersionTransition('1.4.7', '1.4.9'), null);
assert.equal(classifyProjectVersionTransition('1.4.7', '9.99.114514'), null);

console.log('project version policy smoke: ok');
