export type ProjectEntryKind = 'worldbook' | 'regex';

type EntryRef = {
  entry: Record<string, unknown>;
  entryKey: string;
  index: number;
  objectKey?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function primitiveId(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return null;
}

export function getProjectEntryKey(
  kind: ProjectEntryKind,
  entry: Record<string, unknown>,
  index: number,
  objectKey?: string,
): string {
  if (objectKey !== undefined) return `object:${objectKey}`;

  if (kind === 'worldbook') {
    const extensions = asRecord(entry.extensions);
    const id = primitiveId(entry.uid) ?? primitiveId(extensions?.cw_entry_id);
    return id !== null ? `uid:${id}` : `index:${index}`;
  }

  const id = primitiveId(entry.id);
  return id !== null ? `id:${id}` : `index:${index}`;
}

export function extractProjectEntries(raw: unknown, kind: ProjectEntryKind): EntryRef[] {
  if (Array.isArray(raw)) {
    return raw
      .map((value, index) => ({ value: asRecord(value), index }))
      .filter((item): item is { value: Record<string, unknown>; index: number } => item.value !== null)
      .map(({ value, index }) => ({
        entry: value,
        entryKey: getProjectEntryKey(kind, value, index),
        index,
      }));
  }

  const record = asRecord(raw);
  if (!record) return [];

  if (Array.isArray(record.entries)) {
    return record.entries
      .map((value, index) => ({ value: asRecord(value), index }))
      .filter((item): item is { value: Record<string, unknown>; index: number } => item.value !== null)
      .map(({ value, index }) => ({
        entry: value,
        entryKey: getProjectEntryKey(kind, value, index),
        index,
      }));
  }

  const entriesObject = asRecord(record.entries);
  if (entriesObject) {
    return Object.entries(entriesObject)
      .map(([objectKey, value], index) => ({ objectKey, value: asRecord(value), index }))
      .filter(
        (item): item is { objectKey: string; value: Record<string, unknown>; index: number } => item.value !== null,
      )
      .map(({ objectKey, value, index }) => ({
        entry: value,
        entryKey: getProjectEntryKey(kind, value, index, objectKey),
        index,
        objectKey,
      }));
  }

  if (kind === 'regex') {
    return [
      {
        entry: record,
        entryKey: getProjectEntryKey(kind, record, 0),
        index: 0,
      },
    ];
  }

  return [];
}

export function parseProjectJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('项目 JSON 无法解析');
  }
}

export type ProjectContentValidation =
  | { valid: true; entryCount: number }
  | { valid: false; entryCount: 0; error: string };

function hasSupportedContainerShape(raw: unknown, kind: ProjectEntryKind): boolean {
  if (Array.isArray(raw)) return true;

  const record = asRecord(raw);
  if (!record) return false;
  if (Array.isArray(record.entries) || asRecord(record.entries)) return true;

  if (kind === 'regex') {
    return (
      typeof record.findRegex === 'string' ||
      typeof record.find_regex === 'string' ||
      typeof record.replaceString === 'string' ||
      typeof record.replace_string === 'string' ||
      typeof record.scriptName === 'string' ||
      typeof record.script_name === 'string'
    );
  }

  return false;
}

export function validateProjectContentText(text: string, kind: ProjectEntryKind): ProjectContentValidation {
  let raw: unknown;
  try {
    raw = parseProjectJson(text);
  } catch (error) {
    return {
      valid: false,
      entryCount: 0,
      error: error instanceof Error ? error.message : '项目 JSON 无法解析',
    };
  }

  if (!hasSupportedContainerShape(raw, kind)) {
    return {
      valid: false,
      entryCount: 0,
      error: kind === 'worldbook' ? '不支持的世界书 JSON 结构' : '不支持的正则 JSON 结构',
    };
  }

  const entries = extractProjectEntries(raw, kind);
  if (entries.length === 0) {
    return {
      valid: false,
      entryCount: 0,
      error: kind === 'worldbook' ? '世界书没有可识别的条目' : '正则文件没有可识别的条目',
    };
  }

  return { valid: true, entryCount: entries.length };
}

export function removeProjectEntryFromJson(
  text: string,
  kind: ProjectEntryKind,
  entryKey: string,
): { text: string; removed: Record<string, unknown> } {
  const raw = parseProjectJson(text);
  const refs = extractProjectEntries(raw, kind);
  const target = refs.find(ref => ref.entryKey === entryKey);
  if (!target) throw new Error('条目不存在，项目可能已被其他人更新');

  if (Array.isArray(raw)) {
    raw.splice(target.index, 1);
  } else {
    const record = asRecord(raw);
    if (!record) throw new Error('项目 JSON 结构无效');

    if (Array.isArray(record.entries)) {
      record.entries.splice(target.index, 1);
    } else {
      const entriesObject = asRecord(record.entries);
      if (entriesObject && target.objectKey !== undefined) {
        delete entriesObject[target.objectKey];
      } else if (kind === 'regex') {
        return { text: '[]', removed: target.entry };
      } else {
        throw new Error('项目 JSON 结构不支持删除条目');
      }
    }
  }

  return {
    text: JSON.stringify(raw, null, 2),
    removed: target.entry,
  };
}
