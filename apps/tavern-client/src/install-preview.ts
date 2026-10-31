import type { InstallIntent, InstallPreview } from "../../../packages/contracts/src/install.js";
import { projectRegex, projectWorldbook } from "./host-projection.js";
import { capture, discover } from "./install-discovery.js";
import {
  copy,
  type Discovery,
  differences,
  type Group,
  type InstallHost,
  identity,
  isRow,
  type Plan,
  type Row,
  type Snapshot,
} from "./install-model.js";
import { entryKey, regexEntries, worldbookEntries } from "./lib.js";

function incomingWorldbook(intent: InstallIntent, stamp: (key: string) => Row) {
  const book: Row[] = worldbookEntries(intent.files!.worldbook ? JSON.parse(intent.files!.worldbook) : null).map(
    (row, index) => {
      if (!isRow(row)) throw new Error("世界书条目字段格式错误");
      const item = copy(row);
      delete item.uid;
      if (typeof item.content === "string" && item.content.includes("poem-workshop-meta:")) {
        identity(item);
        item.content = item.content.replace(
          /<%# poem-workshop-meta:v1-start\n[\s\S]*?\npoem-workshop-meta:v1-end %>/g,
          "",
        );
      }
      const metadata = stamp(entryKey(item, index));
      return { ...item, extra: { ...item.extra, ...metadata } };
    },
  );
  if (intent.files!.worldbook && !book.length) throw new Error("世界书没有有效条目");
  return book;
}

function incomingRegex(host: InstallHost, intent: InstallIntent) {
  const regex: Row[] = regexEntries(intent.files!.regex ? JSON.parse(intent.files!.regex) : null).map((row, index) => ({
    id: host.uuid(),
    script_name: String(row.scriptName ?? row.script_name ?? index),
    enabled: true,
    find_regex: String(row.findRegex ?? row.find_regex ?? ""),
    replace_string: String(row.replaceString ?? row.replace_string ?? ""),
    trim_strings: row.trimStrings ?? row.trim_strings ?? [],
    source: row.source ?? {
      user_input: Array.isArray(row.placement) && row.placement.includes(1),
      ai_output: Array.isArray(row.placement) && row.placement.includes(2),
      slash_command: Array.isArray(row.placement) && row.placement.includes(3),
      world_info: Array.isArray(row.placement) && row.placement.includes(5),
      reasoning: Array.isArray(row.placement) && row.placement.includes(6),
    },
    destination: row.destination ?? { display: Boolean(row.markdownOnly), prompt: Boolean(row.promptOnly) },
    run_on_edit: Boolean(row.runOnEdit ?? row.run_on_edit),
    min_depth: row.minDepth ?? row.min_depth ?? null,
    max_depth: row.maxDepth ?? row.max_depth ?? null,
  }));
  return regex;
}

function incoming(host: InstallHost, intent: InstallIntent, old: Group | null | undefined, instanceId: string) {
  const project = intent.project;
  let book: Row[] = [];
  let regex: Row[] = [];
  const stamp = (key: string) => ({
    cw_instance_id: instanceId,
    cw_project_id: project!.id,
    cw_project_version: project!.version,
    cw_entry_key: key,
  });
  if (intent.action === "migrate") {
    book = copy(old!.book).map((row) => ({
      ...row,
      extra: {
        ...row.extra,
        cw_project_id: old!.instance.projectId,
        cw_project_version: old!.instance.version,
        cw_entry_key: identity(row)!.key,
        cw_instance_id: instanceId,
      },
    }));
    regex = copy(old!.regex);
  }
  if (["install", "update"].includes(intent.action)) {
    book = incomingWorldbook(intent, stamp);
    regex = incomingRegex(host, intent);
  }
  book = book.map((row) => {
    const projected = projectWorldbook(row);
    const name = String(projected.name ?? "");
    projected.name = name.includes("[WS]") ? name : `[WS] ${name}`;
    return projected;
  });
  regex = regex.map((row) => projectRegex(row));
  return { book, regex };
}

function validateIntent(intent: InstallIntent, snapshot: Snapshot, old: Group | null | undefined) {
  if (intent.action !== "install" && (!old || old.invalid)) throw new Error("目标实例不存在或身份存疑，请重新扫描");
  if (intent.action !== "install" && !intent.instanceId) throw new Error("必须指定实例");
  if (old?.instance.location.character && old.instance.location.character !== snapshot.character)
    throw new Error("当前角色不匹配");
  if (intent.action === "install" && intent.instanceId) throw new Error("新建安装不能指定已有实例");
  if (!["install", "update", "uninstall", "migrate"].includes(intent.action)) throw new Error("未知安装操作");
  if (snapshot.failures.some((f) => f.location.startsWith("角色:"))) throw new Error("角色正则扫描失败");
  const project = intent.project;
  if (
    ["install", "update"].includes(intent.action) &&
    (!project?.id || !project.version || !intent.files || (!intent.files.worldbook && !intent.files.regex))
  )
    throw new Error("安装数据不完整");
  if (old && project && old.instance.projectId !== project.id) throw new Error("项目与实例不匹配");
  if (
    intent.action === "uninstall" &&
    (intent.targetWorldbook || intent.createWorldbook || intent.bindWorldbook || intent.files || intent.project)
  )
    throw new Error("卸载不能变更目标或绑定");
  if (intent.createWorldbook && intent.targetWorldbook && snapshot.names.includes(intent.targetWorldbook))
    throw new Error("新建世界书名称已存在，请选择现有世界书");
  return project;
}

function validateTarget(
  intent: InstallIntent,
  snapshot: Snapshot,
  found: Discovery,
  old: Group | null | undefined,
  target: InstallPreview["target"],
) {
  if (intent.files?.worldbook && !target.worldbook) throw new Error("请选择或新建世界书");
  if (intent.files?.regex && !snapshot.character) throw new Error("无法确认当前角色身份");
  if (target.worldbook && !snapshot.names.includes(target.worldbook) && !intent.createWorldbook)
    throw new Error("目标世界书不存在");
  if (target.worldbook && snapshot.failures.some((f) => f.location === target.worldbook))
    throw new Error("目标世界书读取失败");
  if (old?.instance.location.worldbook && !snapshot.books.has(old.instance.location.worldbook))
    throw new Error("来源世界书读取失败");
  if (
    (target.worldbook && found.ambiguousBooks.has(target.worldbook)) ||
    (old?.instance.location.worldbook && found.ambiguousBooks.has(old.instance.location.worldbook)) ||
    ((old?.instance.location.character || intent.files?.regex) && found.ambiguousCharacter)
  )
    throw new Error("操作位置含身份存疑内容，请先手动卸载并重新下载");
}

export async function preparePlan(host: InstallHost, intent: InstallIntent): Promise<Plan> {
  const snapshot = await capture(host);
  const found = discover(snapshot);
  const old = intent.instanceId ? found.groups.get(intent.instanceId) : null;
  const project = validateIntent(intent, snapshot, old);
  const instanceId = old?.instance.instanceId ?? host.uuid();
  const target = {
    worldbook: intent.targetWorldbook ?? old?.instance.location.worldbook ?? null,
    character: old?.instance.location.character ?? (intent.files?.regex ? snapshot.character : null),
  };
  validateTarget(intent, snapshot, found, old, target);
  let { book, regex } = incoming(host, intent, old, instanceId);
  if (new Set(book.map((row) => identity(row)?.key)).size !== book.length) throw new Error("世界书条目身份重复");
  if (intent.action === "migrate" && (!target.worldbook || target.worldbook === old!.instance.location.worldbook))
    throw new Error("请选择不同的迁移目标");
  if (
    target.worldbook &&
    found.scan.instances.some(
      (i) =>
        i.instanceId !== instanceId &&
        i.projectId === (project?.id ?? old?.instance.projectId) &&
        i.location.worldbook === target.worldbook,
    )
  )
    throw new Error("目标世界书已包含此项目实例");
  if (book.length && target.worldbook) {
    const targetRows = snapshot.books.get(target.worldbook) ?? [];
    const maxUid = Math.max(
      0,
      ...targetRows.map((row) => Number(row.uid)).filter((value) => Number.isSafeInteger(value) && value >= 0),
    );
    if (!Number.isSafeInteger(maxUid + book.length)) throw new Error("目标世界书条目编号已耗尽");
    book = book.map((row, index) => ({ ...row, uid: maxUid + index + 1 }));
  }
  const baseline = snapshot.records[instanceId]?.baseline;
  const playerChanges =
    baseline && old
      ? [...differences("worldbook", baseline.book, old.book), ...differences("regex", baseline.regex, old.regex)]
      : old
        ? [...differences("worldbook", [], old.book), ...differences("regex", [], old.regex)]
        : [];
  const result: InstallPreview = {
    previewId: host.uuid(),
    instanceId,
    action: intent.action,
    instance: old?.instance ?? null,
    target,
    playerChanges,
    changes: [...differences("worldbook", old?.book ?? [], book), ...differences("regex", old?.regex ?? [], regex)],
  };
  return { snapshot, old, book, regex, intent: copy(intent), result };
}
