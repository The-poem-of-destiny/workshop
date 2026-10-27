import { api } from "../../api";
import type { CheckFinding } from "./check-report";

/** A single worldbook entry or regex script read from a frozen submission asset. */
export interface SourceEntry {
  key: string;
  uid: string | number | null;
  name: string;
  content: string;
}

export interface SourceFile {
  kind: "worldbook" | "regex";
  entries: SourceEntry[];
  error: string | null;
}

export interface SourceTarget {
  entryId: string;
  entry: string;
  uid: string | number | null;
  line: number | null;
}

const worldbookPaths = [
  "entries",
  "data.entries",
  "world_info.entries",
  "character_book.entries",
  "data.character_book.entries",
  "characterBook.entries",
  "data.characterBook.entries",
];

function pick(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isRegexScript(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.replaceString === "string" &&
    (typeof record.findRegex === "string" || typeof record.scriptName === "string" || typeof record.id === "string")
  );
}

function worldbookEntries(json: unknown): SourceEntry[] {
  const raw = worldbookPaths.map((path) => pick(json, path)).find((value) => value && typeof value === "object");
  const list: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.map((value, index) => [String(index), value])
    : raw && typeof raw === "object"
      ? Object.entries(raw)
      : [];
  const entries: SourceEntry[] = [];
  for (const [key, value] of list) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (typeof record.content !== "string") continue;
    const uid = record.uid;
    const name = [record.comment, record.name].find((value) => typeof value === "string" && value.trim());
    entries.push({
      key,
      uid: typeof uid === "string" || typeof uid === "number" ? uid : null,
      name: typeof name === "string" ? name.trim() : `Entry ${key}`,
      content: record.content,
    });
  }
  return entries;
}

function regexEntries(json: unknown): SourceEntry[] {
  const record = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  let list: Array<[number, unknown]> = [];
  if (isRegexScript(json)) list = [[0, json]];
  else if (Array.isArray(json)) {
    list = json.map((value, index): [number, unknown] => [index, value]).filter(([, value]) => isRegexScript(value));
  } else if (record) {
    for (const field of ["regex_scripts", "regexScripts", "scripts"]) {
      const value = record[field];
      if (Array.isArray(value) && value.some(isRegexScript)) {
        list = value.map((item, index): [number, unknown] => [index, item]).filter(([, item]) => isRegexScript(item));
        break;
      }
    }
  }
  const entries: SourceEntry[] = [];
  for (const [index, value] of list) {
    if (!isRegexScript(value)) continue;
    const uid = value.id;
    const name = [value.scriptName, value.name].find((item) => typeof item === "string" && item.trim());
    entries.push({
      key: String(index),
      uid: typeof uid === "string" || typeof uid === "number" ? uid : null,
      name: typeof name === "string" ? name.trim() : `Regex ${index + 1}`,
      content: typeof value.replaceString === "string" ? value.replaceString : "",
    });
  }
  return entries;
}

/** Mirrors the checker's extraction so entry keys line up with report entryIds. */
export function parseSourceFile(kind: "worldbook" | "regex", json: unknown): SourceFile {
  const entries = kind === "worldbook" ? worldbookEntries(json) : regexEntries(json);
  if (!entries.length) return { kind, entries, error: "文件中没有可读取的条目。" };
  return { kind, entries, error: null };
}

const sourceCache = new Map<string, Promise<SourceFile>>();

/** Parsed submission source shared by the inline viewer and the Markdown export. */
export function loadSubmissionSource(submissionId: string, kind: "worldbook" | "regex"): Promise<SourceFile> {
  const key = `${submissionId}:${kind}`;
  const cached = sourceCache.get(key);
  if (cached) return cached;
  const request = api
    .adminFile(submissionId, kind)
    .then((blob) => blob.text())
    .then((text) => parseSourceFile(kind, JSON.parse(text) as unknown))
    .catch((value: unknown) => ({ kind, entries: [], error: String(value) }) satisfies SourceFile);
  sourceCache.set(key, request);
  return request;
}

export function clearSubmissionSource(submissionId: string): void {
  for (const key of [...sourceCache.keys()]) {
    if (key.startsWith(`${submissionId}:`)) sourceCache.delete(key);
  }
}

/** Files are named `<kind>.json` by the server-side checker; fall back to the entry id. */
export function findingSourceKind(finding: CheckFinding): "worldbook" | "regex" {
  if (finding.book === "regex.json") return "regex";
  if (finding.book === "worldbook.json") return "worldbook";
  return finding.entryId.split(":")[1] === "regex.json" ? "regex" : "worldbook";
}

export function locateEntry(file: SourceFile, target: SourceTarget): SourceEntry | null {
  const key = target.entryId.split(":").pop();
  if (key) {
    const byKey = file.entries.find((entry) => entry.key === key);
    if (byKey) return byKey;
  }
  if (target.uid !== null && target.uid !== "") {
    const byUid = file.entries.find((entry) => entry.uid !== null && String(entry.uid) === String(target.uid));
    if (byUid) return byUid;
  }
  if (target.entry) {
    const byName =
      file.entries.find((entry) => entry.name === target.entry) ??
      file.entries.find((entry) => entry.name.includes(target.entry) || target.entry.includes(entry.name));
    if (byName) return byName;
  }
  return null;
}

export interface EntryExcerpt {
  start: number;
  end: number;
  total: number;
  lines: string[];
  clipped: boolean;
}

/** Target line ± radius, clipped to the entry; falls back to the opening lines. */
export function entryExcerpt(entry: SourceEntry, line: number | null, radius = 5): EntryExcerpt {
  const lines = entry.content.replace(/\r\n?/g, "\n").split("\n");
  const total = lines.length;
  const target = line === null ? 1 : Math.min(Math.max(line, 1), total);
  const start = Math.max(0, target - 1 - radius);
  const end = Math.min(total, target + radius);
  return { start, end, total, lines: lines.slice(start, end), clipped: start > 0 || end < total };
}
