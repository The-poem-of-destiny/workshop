import assert from 'node:assert/strict';
import {
  extractProjectEntries,
  removeProjectEntryFromJson,
} from '../src/utils/project-content.ts';

const arrayBook = JSON.stringify({ entries: [
  { uid: 10, comment: 'A' },
  { uid: 20, comment: 'B' },
  { uid: 30, comment: 'C' },
] });
assert.deepEqual(extractProjectEntries(JSON.parse(arrayBook), 'worldbook').map(item => item.entryKey), [
  'uid:10', 'uid:20', 'uid:30',
]);
const arrayRemoved = JSON.parse(removeProjectEntryFromJson(arrayBook, 'worldbook', 'uid:20').text);
assert.deepEqual(arrayRemoved.entries.map(entry => entry.uid), [10, 30]);

const objectBook = JSON.stringify({ entries: {
  alpha: { uid: 1, comment: 'A' },
  beta: { uid: 2, comment: 'B' },
} });
assert.deepEqual(extractProjectEntries(JSON.parse(objectBook), 'worldbook').map(item => item.entryKey), [
  'object:alpha', 'object:beta',
]);
const objectRemoved = JSON.parse(removeProjectEntryFromJson(objectBook, 'worldbook', 'object:alpha').text);
assert.deepEqual(Object.keys(objectRemoved.entries), ['beta']);

const singleRegex = JSON.stringify({ id: 'cleanup', scriptName: 'Cleanup' });
const regexRemoved = JSON.parse(removeProjectEntryFromJson(singleRegex, 'regex', 'id:cleanup').text);
assert.deepEqual(regexRemoved, []);

assert.throws(() => removeProjectEntryFromJson(arrayBook, 'worldbook', 'uid:999'), /条目不存在/);
console.log('project content entry removal OK');
