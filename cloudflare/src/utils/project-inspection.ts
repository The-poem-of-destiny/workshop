export type ProjectEntryInspection = {
  hasEjs: boolean;
  hasCharacterArtwork: boolean;
  characterArtworkBlockCount: number;
  inspectionWarnings: string[];
};

export const CHARACTER_ARTWORK_START = '<%# char-info-ejs-builder:start:v2 %>';
export const CHARACTER_ARTWORK_END = '<%# char-info-ejs-builder:end:v2 %>';
export const CHARACTER_ARTWORK_INCOMPLETE_WARNING = 'character_artwork_marker_incomplete';

const EJS_TAG_PATTERN = /<%[\s\S]*?%>/;

function collectStringValues(value: unknown, output: string[], depth = 0): void {
  if (depth > 16 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStringValues(item, output, depth + 1);
    }
  }
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = text.indexOf(needle, cursor);
    if (index < 0) return count;
    count += 1;
    cursor = index + needle.length;
  }
}

function countCompleteCharacterArtworkBlocks(text: string): number {
  let count = 0;
  let cursor = 0;
  while (true) {
    const start = text.indexOf(CHARACTER_ARTWORK_START, cursor);
    if (start < 0) return count;
    const end = text.indexOf(CHARACTER_ARTWORK_END, start + CHARACTER_ARTWORK_START.length);
    if (end < 0) return count;
    count += 1;
    cursor = end + CHARACTER_ARTWORK_END.length;
  }
}

export function inspectProjectEntry(entry: Record<string, unknown>): ProjectEntryInspection {
  const strings: string[] = [];
  collectStringValues(entry, strings);

  let hasEjs = false;
  let startCount = 0;
  let endCount = 0;
  let completeBlockCount = 0;

  for (const text of strings) {
    if (!hasEjs && EJS_TAG_PATTERN.test(text)) hasEjs = true;
    startCount += countOccurrences(text, CHARACTER_ARTWORK_START);
    endCount += countOccurrences(text, CHARACTER_ARTWORK_END);
    completeBlockCount += countCompleteCharacterArtworkBlocks(text);
  }

  const pairedMarkerCount = Math.min(startCount, endCount);
  const hasIncompleteArtworkMarker =
    startCount !== endCount || completeBlockCount < pairedMarkerCount;

  return {
    hasEjs,
    hasCharacterArtwork: completeBlockCount > 0,
    characterArtworkBlockCount: completeBlockCount,
    inspectionWarnings: hasIncompleteArtworkMarker ? [CHARACTER_ARTWORK_INCOMPLETE_WARNING] : [],
  };
}
