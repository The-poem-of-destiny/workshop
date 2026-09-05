import assert from 'node:assert/strict';
import {
  extractProjectEntries,
  removeProjectEntryFromJson,
  validateProjectContentText,
} from '../src/utils/project-content.ts';
import {
  CHARACTER_ARTWORK_INCOMPLETE_WARNING,
  inspectProjectEntry,
} from '../src/utils/project-inspection.ts';
import { parseRegexEntriesPreview, parseWorldbookEntriesPreview } from '../src/utils/project-preview.ts';

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

assert.equal(validateProjectContentText(arrayBook, 'worldbook').valid, true);
assert.equal(validateProjectContentText(objectBook, 'worldbook').valid, true);
assert.equal(validateProjectContentText('[{"id":"cleanup","findRegex":"foo"}]', 'regex').valid, true);
assert.equal(validateProjectContentText(singleRegex, 'regex').valid, true);
assert.equal(validateProjectContentText('{"hello":"world"}', 'worldbook').valid, false);
assert.equal(validateProjectContentText('{"hello":"world"}', 'regex').valid, false);
assert.equal(validateProjectContentText('{"entries":[]}', 'worldbook').valid, false);
assert.equal(validateProjectContentText('not-json', 'worldbook').valid, false);

const plainInspection = inspectProjectEntry({ content: '普通世界书内容' }, 'worldbook');
assert.equal(plainInspection.hasEjs, false);
assert.equal(plainInspection.hasCharacterArtwork, false);

const normalEjsInspection = inspectProjectEntry({ content: '<%_ const value = 1; _%>正文' }, 'worldbook');
assert.equal(normalEjsInspection.hasEjs, true);
assert.equal(normalEjsInspection.hasCharacterArtwork, false);

const artworkContent = `<%# char-info-ejs-builder:start:v2 %>
<%_
{
  const profile = {
    "characterName": "克瑞西达",
    "avatarUrl": "https://files.catbox.moe/2lwbf6.png",
    "coverUrl": "https://files.catbox.moe/p6vp2s.png",
    "gallery": [{ "title": "主立绘", "sources": ["https://files.catbox.moe/9ayahb.webm"] }]
  };
  setLocalVar('char_info.profile', profile);
}
_%>
<%# char-info-ejs-builder:end:v2 %>`;
const artworkInspection = inspectProjectEntry({ content: artworkContent }, 'worldbook');
assert.equal(artworkInspection.hasEjs, true);
assert.equal(artworkInspection.hasCharacterArtwork, true);
assert.equal(artworkInspection.characterArtworkBlockCount, 1);
assert.deepEqual(artworkInspection.inspectionWarnings, []);

const brokenArtworkInspection = inspectProjectEntry(
  { content: '<%# char-info-ejs-builder:start:v2 %>\n<%_ const profile = {}; _%>\n后面的世界书正文' },
  'worldbook',
);
assert.equal(brokenArtworkInspection.hasEjs, true);
assert.equal(brokenArtworkInspection.hasCharacterArtwork, false);
assert.deepEqual(brokenArtworkInspection.inspectionWarnings, [CHARACTER_ARTWORK_INCOMPLETE_WARNING]);

const findOnlyRegexInspection = inspectProjectEntry(
  { findRegex: '<%_.*?_%>', replaceString: '普通替换文本' },
  'regex',
);
assert.equal(findOnlyRegexInspection.hasEjs, false);

const replaceEjsInspection = inspectProjectEntry(
  { findRegex: 'foo', replaceString: '<%= value %>' },
  'regex',
);
assert.equal(replaceEjsInspection.hasEjs, true);

const previewBook = JSON.stringify({ entries: [{ uid: 1, comment: '立绘模板', content: artworkContent }] });
const previewEntry = parseWorldbookEntriesPreview(previewBook)[0];
assert.equal(previewEntry.hasEjs, true);
assert.equal(previewEntry.hasCharacterArtwork, true);
assert.equal(previewEntry.characterArtworkBlockCount, 1);

const regexPreview = parseRegexEntriesPreview(JSON.stringify([{ id: 'ejs', replaceString: '<%= value %>' }]))[0];
assert.equal(regexPreview.hasEjs, true);
assert.equal(regexPreview.hasCharacterArtwork, false);

console.log('project content validation, entry removal, and content inspection OK');
