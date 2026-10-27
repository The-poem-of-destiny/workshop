import { createHash } from "node:crypto";

export const SOURCE_TABLES = ["users", "projects", "assets"];
export const TABLES = ["users", "projects", "project_revisions", "assets", "revision_entry_index"];
export const SHA256 = /^[a-f0-9]{64}$/i;

export const text = (value) => (typeof value === "string" ? value : value == null ? "" : String(value));
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const stableRows = (rows) =>
  [...rows].sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
export const generatedId = (prefix, value) => `${prefix}-${hash(value).slice(0, 24)}`;

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
