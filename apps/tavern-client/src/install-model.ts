import type {
  InstallDiff,
  InstallInstance,
  InstallIntent,
  InstallPreview,
  InstallScan,
} from "../../../packages/contracts/src/install.js";
export type Row = {
  [key: string]: unknown;
  uid?: number;
  id?: string;
  name?: string;
  comment?: string;
  content?: string;
  enabled?: boolean;
  script_name?: string;
  replace_string?: string;
  extensions?: Row;
  extra?: Row;
  cw_project_id?: string;
  cw_project_version?: string;
  cw_entry_key?: string;
  cw_instance_id?: string;
  schemaVersion?: number;
  projectId?: string;
  installedVersion?: string;
  characterAvatar?: string;
  entries?: { regexId: string; entryKey: string; installedVersion?: string }[];
};
export type Identity = { projectId: string; version: string; key: string; instanceId?: string };
export type RecordSet = { instance: InstallInstance; baseline: { book: Row[]; regex: Row[] }; pending?: boolean };
export type Snapshot = {
  names: string[];
  character: string | null;
  books: Map<string, Row[]>;
  regex: Row[];
  failures: InstallScan["failures"];
  bindings: { primary: string | null; additional: string[] };
  records: Record<string, RecordSet>;
};
export type Group = { instance: InstallInstance; book: Row[]; regex: Row[]; invalid?: boolean };
export type Discovery = { clearedPending: string[]; groups: Map<string, Group>; scan: InstallScan };
export type Plan = {
  snapshot: Snapshot;
  old: Group | null | undefined;
  book: Row[];
  regex: Row[];
  intent: InstallIntent;
  result: InstallPreview;
};
export function isRow(value: unknown): value is Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = Object.entries(value);
  for (const [key, field] of fields) {
    if (["extensions", "extra"].includes(key) && field !== undefined && !isRow(field)) return false;
    if (
      ["content", "id", "name", "comment", "script_name", "replace_string"].includes(key) &&
      field !== undefined &&
      typeof field !== "string"
    )
      return false;
  }
  return true;
}
export interface InstallHost {
  character(): string | null;
  names(): string[];
  bindings(): { primary: string | null; additional: string[] };
  book(name: string): Promise<Row[]>;
  regex(): Row[];
  updateBook(name: string, update: (rows: Row[]) => Row[]): Promise<unknown>;
  updateRegex(update: (rows: Row[]) => Row[]): Promise<unknown>;
  createBook(name: string): Promise<unknown>;
  bind(name: string): Promise<unknown>;
  records(): Record<string, RecordSet>;
  saveRecords(records: Record<string, RecordSet>): Promise<unknown>;
  uuid(): string;
}
export const START = "<%# poem-workshop-meta:v1-start\n";
export const END = "\npoem-workshop-meta:v1-end %>";
export const MANIFEST = "poem-workshop-character-regex-meta:v1\n";
export const REGEX_RECORD = "poem-workshop-regex-meta:v1\n";
export const guidance = "身份无法可靠确认，请手动卸载疑似内容后重新下载；不要认领或补写标记。";
export const copy = <T>(value: T): T => structuredClone(value);
export function stable(value: unknown): string {
  if (value instanceof RegExp) return stable({ $regexp: value.source, flags: value.flags });
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function payload(row: Row): Row {
  const result = copy(row);
  delete result.uid;
  if (result.extensions) {
    delete result.extensions.cw_instance_id;
  }
  return result;
}
export function identity(row: Row): Identity | null {
  const content = String(row.content ?? "");
  let meta: Row = row.extensions?.cw_project_id ? row.extensions : (row.extra ?? row.extensions ?? {});
  if (content.includes("poem-workshop-meta:")) {
    const blocks = [...content.matchAll(/<%# poem-workshop-meta:v1-start\n([\s\S]*?)\npoem-workshop-meta:v1-end %>/g)];
    if (
      !blocks.length ||
      content.split(START).length - 1 !== blocks.length ||
      content.split(END).length - 1 !== blocks.length
    )
      throw new Error("正文身份块损坏");
    const values = blocks.map((block) => {
      const parsed: unknown = JSON.parse(block[1]!);
      if (
        !isRow(parsed) ||
        typeof parsed.cw_project_name_display !== "string" ||
        !["string", "number"].includes(typeof parsed.cw_name_format_version)
      )
        throw new Error("正文身份字段不完整");
      return parsed;
    });
    if (new Set(values.map((v) => stable([v.cw_project_id, v.cw_entry_key, v.cw_project_version]))).size !== 1)
      throw new Error("正文存在冲突身份");
    meta = values[0]!;
  }
  if (!meta.cw_project_id) {
    if (meta.fate_project_name || /\[DLC\]|\[工坊\]/.test(String(row.name ?? row.comment ?? "")))
      throw new Error("仅有旧名称，不能证明项目身份");
    return null;
  }
  if (
    typeof meta.cw_project_id !== "string" ||
    typeof meta.cw_entry_key !== "string" ||
    !meta.cw_entry_key ||
    typeof meta.cw_project_version !== "string" ||
    !meta.cw_project_version
  )
    throw new Error("缺少明确项目、版本或唯一条目身份");
  const native = row.extra ?? row.extensions;
  const instanceId =
    meta.cw_instance_id ??
    (native?.cw_project_id === meta.cw_project_id && native.cw_entry_key === meta.cw_entry_key
      ? native.cw_instance_id
      : undefined);
  return { projectId: meta.cw_project_id, key: meta.cw_entry_key, version: meta.cw_project_version, instanceId };
}
export function regexIdentity(row: Row): Identity | null {
  if (row.extensions?.cw_instance_id) return identity({ extensions: row.extensions });
  const match = /^creative_workshop:([^:]+):v1:([^:]+):([^:]*)$/.exec(String(row.id ?? ""));
  if (match && match[3]) {
    const decode = (v: string) => v.replace(/%3A/gi, ":").replace(/%25/gi, "%");
    return { projectId: match[1]!, key: decode(match[2]!), version: decode(match[3]) };
  }
  if (/^(creative_workshop:|cw-)/.test(String(row.id ?? "")) || String(row.script_name ?? "").startsWith("[工坊]"))
    throw new Error("正则缺少可靠版本或实例归属");
  return null;
}
export function differences(kind: InstallDiff["kind"], before: Row[], after: Row[]): InstallDiff[] {
  const key = (row: Row, index: number) =>
    kind === "regex"
      ? String(row.id ?? index)
      : String(row.extensions?.cw_entry_key ?? row.extra?.cw_entry_key ?? row.uid ?? index);
  const a = new Map(before.map((row, index) => [key(row, index), stable(payload(row))]));
  const b = new Map(after.map((row, index) => [key(row, index), stable(payload(row))]));
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((k) => a.get(k) !== b.get(k))
    .map((k) => ({ kind, key: k, before: a.get(k) ?? null, after: b.get(k) ?? null }));
}
