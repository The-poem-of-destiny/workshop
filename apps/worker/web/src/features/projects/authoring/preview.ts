import { normalizeProjectType, PROJECT_CONTENT_POLICY } from "@workshop/domain";

export type WorldbookEntryPreview = {
  name: string;
  keys: string[];
  secondaryKeys: string[];
  position: string;
  order: number;
  depth: number;
  enabled: boolean;
  contentChars: number;
  hasEjs: boolean;
  content: string;
};

export type RegexEntryPreview = {
  scriptName: string;
  findRegex: string;
  replaceChars: number;
  disabled: boolean;
  source: string;
};

export type WorldbookAsset = {
  kind: "worldbook";
  file: File;
  text: string;
  entries: WorldbookEntryPreview[];
};

export type RegexAsset = {
  kind: "regex";
  file: File;
  text: string;
  raw: unknown[];
  entries: RegexEntryPreview[];
};

export type JsonAsset = WorldbookAsset | RegexAsset;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const POSITION_LABELS: Record<string, string> = {
  before_character_definition: "角色定义前",
  after_character_definition: "角色定义后",
  before_author_note: "作者注释前",
  after_author_note: "作者注释后",
  at_depth: "按深度插入",
  before_example_messages: "示例消息前",
  after_example_messages: "示例消息后",
  outlet: "指定出口",
};

const POSITION_ALIASES: Record<string, string> = {
  before_char: "before_character_definition",
  after_char: "after_character_definition",
};

const LEGACY_POSITIONS = [
  "before_character_definition",
  "after_character_definition",
  "before_author_note",
  "after_author_note",
  "at_depth",
  "before_example_messages",
  "after_example_messages",
  "outlet",
];

const META_BLOCK = /<%# poem-workshop-meta:v1-start\n[\s\S]*?\npoem-workshop-meta:v1-end %>/g;
const REGEX_SUMMARY_LENGTH = 120;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringItems(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function worldbookEntryValues(root: unknown): unknown[] | null {
  if (Array.isArray(root)) return root;
  const record = asRecord(root);
  if (!record) return null;
  const entries = record.entries;
  if (Array.isArray(entries)) return entries;
  const entryRecord = asRecord(entries);
  if (entryRecord) return Object.values(entryRecord);
  return null;
}

export function positionLabel(entry: Record<string, unknown>): string {
  const position = asRecord(entry.position);
  const raw = position?.type ?? entry.positionType ?? entry.position_type ?? entry.position;
  if (typeof raw === "string") {
    const normalized = POSITION_ALIASES[raw] ?? raw;
    return POSITION_LABELS[normalized] ?? normalized;
  }
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw < LEGACY_POSITIONS.length) {
    const normalized = LEGACY_POSITIONS[raw] ?? "";
    return normalized ? (POSITION_LABELS[normalized] ?? normalized) : `位置 ${raw}`;
  }
  if (raw === undefined || raw === null) return "未指定";
  return `位置 ${String(raw)}`;
}

function normalizeWorldbookEntry(value: unknown, index: number): WorldbookEntryPreview {
  const entry = asRecord(value) ?? {};
  const position = asRecord(entry.position);
  const contentCandidate = entry.content ?? entry.text;
  const rawContent = typeof contentCandidate === "string" ? contentCandidate : "";
  const inspectable = rawContent.replace(META_BLOCK, "");
  const comment = typeof entry.comment === "string" ? entry.comment : "";
  const legacyName = typeof entry.name === "string" ? entry.name : "";
  const order = position?.order ?? entry.order;
  const depth = position?.depth ?? entry.depth;
  return {
    name: comment || legacyName || `条目 ${index + 1}`,
    keys: stringItems(Array.isArray(entry.key) ? entry.key : entry.keys),
    secondaryKeys: stringItems(Array.isArray(entry.keysecondary) ? entry.keysecondary : entry.key_secondary),
    position: positionLabel(entry),
    order: typeof order === "number" && Number.isFinite(order) ? order : index,
    depth: typeof depth === "number" && Number.isFinite(depth) ? depth : 4,
    enabled: entry.enabled === undefined ? entry.disable !== true : entry.enabled !== false,
    contentChars: Array.from(inspectable).length,
    hasEjs: /<%[\s\S]*?%>/.test(inspectable),
    content: rawContent,
  };
}

function regexSummary(findRegex: string): string {
  const collapsed = findRegex.replace(/\s+/g, " ").trim();
  if (!collapsed) return "（空表达式）";
  return collapsed.length > REGEX_SUMMARY_LENGTH ? `${collapsed.slice(0, REGEX_SUMMARY_LENGTH)}…` : collapsed;
}

function normalizeRegexEntry(value: unknown, index: number): RegexEntryPreview {
  const entry = asRecord(value) ?? {};
  const scriptName = typeof entry.scriptName === "string" ? entry.scriptName : "";
  const legacyName = typeof entry.name === "string" ? entry.name : "";
  const source = typeof entry.replaceString === "string" ? entry.replaceString : "";
  return {
    scriptName: scriptName || legacyName || `正则 ${index + 1}`,
    findRegex: regexSummary(typeof entry.findRegex === "string" ? entry.findRegex : ""),
    replaceChars: Array.from(source).length,
    disabled: entry.disabled === true || entry.disable === true,
    source,
  };
}

export function parseWorldbookText(text: string): ParseResult<WorldbookEntryPreview[]> {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    return { ok: false, error: `不是有效的 JSON：${message}` };
  }
  const values = worldbookEntryValues(root);
  if (!values) return { ok: false, error: "缺少 entries 数组或对象，无法识别世界书条目。" };
  return { ok: true, value: values.map((entry, index) => normalizeWorldbookEntry(entry, index)) };
}

export function parseRegexText(text: string): ParseResult<{ raw: unknown[]; entries: RegexEntryPreview[] }> {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    return { ok: false, error: `不是有效的 JSON：${message}` };
  }
  const raw = Array.isArray(root) ? root : asRecord(root) ? [root] : null;
  if (!raw) return { ok: false, error: "正则 JSON 必须是对象或对象数组。" };
  return { ok: true, value: { raw, entries: raw.map((entry, index) => normalizeRegexEntry(entry, index)) } };
}

export async function loadWorldbookAsset(file: File): Promise<ParseResult<WorldbookAsset>> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: `无法读取 ${file.name}，请重新选择文件。` };
  }
  const parsed = parseWorldbookText(text);
  if (!parsed.ok) return { ok: false, error: `${file.name}：${parsed.error}` };
  return { ok: true, value: { kind: "worldbook", file, text, entries: parsed.value } };
}

export async function loadRegexAsset(file: File): Promise<ParseResult<RegexAsset>> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: `无法读取 ${file.name}，请重新选择文件。` };
  }
  const parsed = parseRegexText(text);
  if (!parsed.ok) return { ok: false, error: `${file.name}：${parsed.error}` };
  return { ok: true, value: { kind: "regex", file, text, raw: parsed.value.raw, entries: parsed.value.entries } };
}

export function fileKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

/** Backend stores one regex asset per revision, so multiple files are merged into one JSON array. */
export function mergedRegexUpload(assets: readonly RegexAsset[]): File | null {
  const first = assets[0];
  if (!first) return null;
  if (assets.length === 1) return first.file;
  const raw = assets.flatMap((asset) => asset.raw);
  return new File([JSON.stringify(raw, null, 2)], `merged-regex-${assets.length}-files.json`, {
    type: "application/json",
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short author-facing hint derived from the domain content policy for the selected project type. */
export function contentRequirementHint(projectType: string): string | null {
  const type = normalizeProjectType(projectType);
  if (!type) return null;
  const rule = PROJECT_CONTENT_POLICY[type];
  if (rule.required.includes("worldbook")) return `${type}项目必须上传世界书；正则文件可选。`;
  if (rule.anyOf.length > 0) return `${type}项目需要世界书或正则文件中的至少一个。`;
  return `${type}项目没有强制的内容文件要求。`;
}
