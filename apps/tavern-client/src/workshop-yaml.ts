import { type Document, isMap, isNode, isScalar, parseDocument, visit } from "yaml";
import type { InstallProject } from "../../../packages/contracts/src/install.js";
import { projectWorldbook } from "./host-projection.js";
import type { Identity, Row } from "./install-model.js";

export const INDEX_NAME = "[WS]创意工坊项目注册表";
const BLOCK = /<%#([\s\S]*?)%>/g;
const LEGACY = /<%# poem-workshop-meta:v1-start\n[\s\S]*?\npoem-workshop-meta:v1-end %>/g;

type IndexProject = {
  project_id: string;
  version_id: string;
  title: string | null;
  description: string | null;
  author: { id: string | null; name: string | null } | null;
  version_label: string | null;
};
function documentFor(content: string, namespace: string) {
  let found: { start: number; end: number; doc: Document } | null = null;
  for (const match of content.matchAll(BLOCK)) {
    const doc = parseDocument(match[1]!, { uniqueKeys: true });
    if (!isMap(doc.contents) || !doc.contents.items.some((pair) => isScalar(pair.key) && pair.key.value === namespace))
      continue;
    if (doc.errors.length || found) throw new Error(`${namespace} YAML 损坏或重复`);
    found = { start: match.index!, end: match.index! + match[0].length, doc };
  }
  return found;
}
function encode(doc: Document) {
  if (doc.comment?.includes("%>") || doc.commentBefore?.includes("%>"))
    throw new Error("YAML 注释包含无法安全保留的 EJS 结束符");
  visit(doc, (_key, node) => {
    if (isNode(node) && (node.comment?.includes("%>") || node.commentBefore?.includes("%>")))
      throw new Error("YAML 注释包含无法安全保留的 EJS 结束符");
    if (isScalar(node) && typeof node.value === "string" && node.value.includes("%>")) node.type = "QUOTE_DOUBLE";
  });
  return `<%#\n${doc.toString().replace(/%>/g, "%\\u003e")}%>`;
}
function setNamespace(content: string, namespace: string, value: unknown) {
  const existing = documentFor(content, namespace);
  const doc = existing?.doc ?? parseDocument("{}");
  doc.set(namespace, doc.createNode(value));
  const block = encode(doc);
  return existing
    ? content.slice(0, existing.start) + block + content.slice(existing.end)
    : `${content}${content ? "\n" : ""}${block}`;
}
export function entryIdentity(content: string): Identity | null {
  const block = documentFor(content, "workshop_entry");
  if (!block) return null;
  const value = (block.doc.toJS() as Record<string, unknown>).workshop_entry as Record<string, unknown> | undefined;
  if (
    !value ||
    value.version !== 1 ||
    typeof value.project_id !== "string" ||
    !value.project_id ||
    typeof value.entry_key !== "string" ||
    !value.entry_key ||
    typeof value.version_id !== "string" ||
    !value.version_id
  )
    throw new Error("workshop_entry 身份字段不完整");
  return { projectId: value.project_id, key: value.entry_key, version: value.version_id };
}
export function writeEntry(row: Row, id: Identity): Row {
  const result = structuredClone(row);
  result.content = setNamespace(String(result.content ?? "").replace(LEGACY, ""), "workshop_entry", {
    version: 1,
    project_id: id.projectId,
    entry_key: id.key,
    version_id: id.version,
  });
  for (const field of [result.extra, result.extensions])
    if (field)
      for (const key of ["cw_project_id", "cw_project_version", "cw_entry_key", "cw_instance_id"]) delete field[key];
  return result;
}
export function isIndex(row: Row) {
  return String(row.name ?? row.comment ?? "") === INDEX_NAME;
}
export function readIndex(rows: Row[]): IndexProject[] {
  const indices = rows.filter(isIndex);
  if (indices.length > 1) throw new Error("世界书包含多个工坊注册表");
  if (!indices.length) return [];
  const block = documentFor(String(indices[0]!.content ?? ""), "workshop_index");
  const index = (block?.doc.toJS() as Record<string, unknown> | undefined)?.workshop_index as
    | { version?: unknown; projects?: unknown }
    | undefined;
  if (!index || index.version !== 1 || !Array.isArray(index.projects)) throw new Error("工坊注册表损坏");
  const ids = new Set<string>();
  for (const item of index.projects) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.project_id !== "string" ||
      !item.project_id ||
      typeof item.version_id !== "string" ||
      !item.version_id ||
      ids.has(item.project_id)
    )
      throw new Error("工坊注册表项目身份冲突");
    ids.add(item.project_id);
  }
  return index.projects as IndexProject[];
}
export function updateIndex(rows: Row[], remove: string | null, project: IndexProject | null): Row[] {
  const projects = readIndex(rows).filter(
    (item) => item.project_id !== remove && item.project_id !== project?.project_id,
  );
  if (project) projects.push(project);
  const old = rows.find(isIndex);
  if (!old && !project) return rows;
  const uid = Math.max(0, ...rows.map((row) => (typeof row.uid === "number" ? row.uid : 0))) + 1;
  const row: Row = old
    ? structuredClone(old)
    : projectWorldbook({ uid, name: INDEX_NAME, enabled: false, content: "" });
  row.content = setNamespace(String(row.content ?? ""), "workshop_index", { version: 1, projects });
  return old ? rows.map((item) => (item === old ? row : item)) : [...rows, row];
}
export function indexProject(id: string, version: string, project?: InstallProject | null): IndexProject {
  return {
    project_id: id,
    version_id: version,
    title: project?.title ?? null,
    description: project?.description ?? null,
    author: project?.author ?? null,
    version_label: project?.versionLabel ?? null,
  };
}
