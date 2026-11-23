export type ProjectEntryKind = "worldbook" | "regex";
export type ProjectContentPresence = Record<ProjectEntryKind, boolean>;

export function validateProjectContentPresence(
  presence: ProjectContentPresence,
): { valid: true } | { valid: false; error: string } {
  return presence.worldbook || presence.regex
    ? { valid: true }
    : { valid: false, error: "项目必须包含有效且非空的世界书或正则" };
}

type EntryRef = {
  entry: Record<string, unknown>;
  entryKey: string;
  index: number;
  objectKey?: string;
};

const MAX_PROJECT_ENTRIES = 2000;
const MAX_PROJECT_ENTRY_KEY_LENGTH = 2000;
const MAX_PROJECT_ENTRY_NAME_LENGTH = 2000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function primitiveId(value: unknown): string | null {
  if (typeof value === "string") return value.trim().length > 0 ? value : null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  return null;
}

export function getProjectEntryKey(
  kind: ProjectEntryKind,
  entry: Record<string, unknown>,
  index: number,
  objectKey?: string,
): string {
  if (objectKey !== undefined) return `object:${objectKey}`;

  if (kind === "worldbook") {
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

  if (kind === "regex") {
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

function formatWorldbookEntryName(entry: Record<string, unknown>): string {
  const base =
    [entry.name, entry.comment].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ) ?? "";
  return base.trimStart().startsWith("[工坊]") ? base : `[工坊] ${base}`;
}

/** Mutates parsed upload entries so all consumers see the same installed name. */
export function markWorldbookNames(raw: unknown): void {
  for (const { entry } of extractProjectEntries(raw, "worldbook")) {
    const marked = formatWorldbookEntryName(entry);
    entry.name = marked;
    if ("comment" in entry) entry.comment = marked;
  }
}

function parseProjectJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("项目 JSON 无法解析");
  }
}

export type ProjectContentValidation =
  | { valid: true; entryCount: number }
  | { valid: false; entryCount: 0; error: string };

function getWorldbookImportValues(raw: unknown): unknown[] | null {
  const record = asRecord(raw);
  if (!record) return null;
  if (Array.isArray(record.entries)) return record.entries;

  const entriesObject = asRecord(record.entries);
  if (entriesObject) return Object.values(entriesObject);
  return null;
}

function getRegexImportValues(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  return asRecord(raw) ? [raw] : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSillyTavernWorldbookJson(raw: unknown): boolean {
  const values = getWorldbookImportValues(raw);
  return values !== null && values.length > 0 && values.every((value) => asRecord(value) !== null);
}

function isSillyTavernRegexJson(raw: unknown): boolean {
  const values = getRegexImportValues(raw);
  return (
    values !== null &&
    values.length > 0 &&
    values.every((value) => {
      const record = asRecord(value);
      return Boolean(record && isNonEmptyString(record.scriptName) && typeof record.replaceString === "string");
    })
  );
}

export function validateProjectContentText(text: string, kind: ProjectEntryKind): ProjectContentValidation {
  let raw: unknown;
  try {
    raw = parseProjectJson(text);
  } catch (error) {
    return {
      valid: false,
      entryCount: 0,
      error: error instanceof Error ? error.message : "项目 JSON 无法解析",
    };
  }
  return validateProjectContent(raw, kind);
}

function validateExtractedEntries(refs: EntryRef[], kind: ProjectEntryKind): ProjectContentValidation | null {
  const label = kind === "worldbook" ? "世界书" : "正则";
  const seenKeys = new Set<string>();
  for (const ref of refs) {
    if (ref.entryKey.length > MAX_PROJECT_ENTRY_KEY_LENGTH) {
      return { valid: false, entryCount: 0, error: `${label}条目标识不能超过 2000 个字符` };
    }
    if (seenKeys.has(ref.entryKey)) {
      return { valid: false, entryCount: 0, error: `${label}存在重复的条目标识` };
    }
    seenKeys.add(ref.entryKey);

    const candidateNames =
      kind === "worldbook"
        ? [formatWorldbookEntryName(ref.entry), ref.entry.name, ref.entry.comment]
        : [ref.entry.scriptName, ref.entry.name, ref.entry.comment];
    if (candidateNames.some((value) => typeof value === "string" && value.length > MAX_PROJECT_ENTRY_NAME_LENGTH)) {
      return { valid: false, entryCount: 0, error: `${label}条目名称不能超过 2000 个字符` };
    }
  }
  return null;
}

export function validateProjectContent(raw: unknown, kind: ProjectEntryKind): ProjectContentValidation {
  if (kind === "worldbook") {
    const values = getWorldbookImportValues(raw);
    if (values === null) {
      return {
        valid: false,
        entryCount: 0,
        error: isSillyTavernRegexJson(raw)
          ? "检测到正则 JSON，请上传到正则文件"
          : "不支持的世界书 JSON 结构：需要 SillyTavern 世界书的顶层 entries",
      };
    }
    if (values.length === 0) {
      return { valid: false, entryCount: 0, error: "世界书没有可识别的条目" };
    }
    if (values.length > MAX_PROJECT_ENTRIES) {
      return { valid: false, entryCount: 0, error: "世界书条目数量不能超过 2000 条" };
    }
    if (!values.every((value) => asRecord(value) !== null)) {
      return { valid: false, entryCount: 0, error: "世界书 JSON 格式不正确：entries 必须只包含条目对象" };
    }
    const entryError = validateExtractedEntries(extractProjectEntries(raw, "worldbook"), "worldbook");
    if (entryError) return entryError;
    return { valid: true, entryCount: values.length };
  }

  const values = getRegexImportValues(raw);
  if (values === null) {
    return { valid: false, entryCount: 0, error: "不支持的正则 JSON 结构" };
  }
  if (values.length === 0) {
    return { valid: false, entryCount: 0, error: "正则文件没有可识别的条目" };
  }
  if (values.length > MAX_PROJECT_ENTRIES) {
    return { valid: false, entryCount: 0, error: "正则条目数量不能超过 2000 条" };
  }
  if (
    !values.every((value) => {
      const record = asRecord(value);
      return Boolean(record && isNonEmptyString(record.scriptName));
    })
  ) {
    return {
      valid: false,
      entryCount: 0,
      error: isSillyTavernWorldbookJson(raw)
        ? "检测到世界书 JSON，请上传到世界书文件"
        : "正则 JSON 格式不正确：每个正则必须包含非空 scriptName",
    };
  }
  if (!values.every((value) => typeof asRecord(value)?.replaceString === "string")) {
    return {
      valid: false,
      entryCount: 0,
      error: "正则 JSON 格式不正确：每个正则必须包含字符串类型的 replaceString",
    };
  }

  const entryError = validateExtractedEntries(extractProjectEntries(raw, "regex"), "regex");
  if (entryError) return entryError;
  return { valid: true, entryCount: values.length };
}
