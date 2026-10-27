import type { InstallProject, InstallRegistryEntry } from "./install-registry.js";
import { entryKey, entryName, hasForeignBaselineConflict, hashText, projectEntry, worldbookEntries } from "./lib.js";

export async function ensureTargetWorldbook(requested?: string | null): Promise<string> {
  const bindings = getCharWorldbookNames("current");
  const target = (requested || bindings.primary || "").trim();
  if (!target) throw new Error("当前角色卡未绑定世界书，请先创建或选择一本世界书");
  if (!getWorldbookNames().includes(target)) await createWorldbook(target, []);
  if (target !== bindings.primary && !(bindings.additional || []).includes(target)) {
    await rebindCharWorldbooks("current", {
      primary: bindings.primary,
      additional: [...(bindings.additional || []), target],
    });
  }
  return target;
}

export async function removePreviousWorldbook(
  projectId: string,
  previous: InstallRegistryEntry | undefined,
  target: string,
) {
  if (previous && previous.worldbookName && previous.worldbookName !== target) {
    const oldBook = previous.worldbookName;
    if (getWorldbookNames().includes(oldBook)) {
      await updateWorldbookWith(oldBook, (entries) =>
        entries.filter(
          (entry) =>
            entry?.extensions?.cw_project_id !== projectId ||
            entry?.extensions?.cw_project_version !== previous.version,
        ),
      );
    }
  }
}

export async function installWorldbook(project: InstallProject, text: string | undefined, target: string) {
  const incoming = worldbookEntries(text ? JSON.parse(text) : null);
  if (text && incoming.length === 0) throw new Error("世界书文件没有有效条目");
  const current = await getWorldbook(target);
  const oldByKey = new Map<string, WorkshopWorldbookEntry>();
  for (const [index, entry] of current.entries()) oldByKey.set(entryKey(entry, index), entry);

  const desiredKeys = new Set<string>();
  const conflicts: string[] = [];
  const result: WorkshopWorldbookEntry[] = [];
  for (const entry of current) {
    if (!projectEntry(entry) || entry.extensions.cw_project_id !== project.id) result.push(entry);
  }

  for (const [index, raw] of incoming.entries()) {
    const key = entryKey(raw, index);
    if (desiredKeys.has(key)) throw new Error(`世界书条目身份重复：${key}`);
    desiredKeys.add(key);
    if (hasForeignBaselineConflict(current, raw, key)) {
      conflicts.push(`${entryName(raw, key)}（与现有非工坊条目同名，保留原条目）`);
      continue;
    }
    const old = oldByKey.get(key);
    const oldHash = old?.extensions?.cw_installed_hash;
    const oldContentHash = old ? await hashText(String(old.content ?? "")) : null;
    if (old && typeof oldHash === "string" && oldContentHash !== oldHash) {
      result.push(old);
      conflicts.push(`${entryName(old, key)}（玩家已修改，保留当前内容）`);
      continue;
    }
    const contentHash = await hashText(String(raw.content ?? ""));
    const extensions = raw.extensions && typeof raw.extensions === "object" ? { ...raw.extensions } : {};
    result.push({
      ...raw,
      extensions: {
        ...extensions,
        cw_project_id: project.id,
        cw_project_version: project.version ?? "",
        cw_entry_key: key,
        cw_project_name_display: project.title ?? "",
        cw_installed_hash: contentHash,
      },
    });
  }

  for (const entry of current) {
    if (!projectEntry(entry) || entry.extensions.cw_project_id !== project.id) continue;
    const key = entryKey(entry, current.indexOf(entry));
    if (desiredKeys.has(key)) continue;
    const oldHash = entry.extensions.cw_installed_hash;
    const currentHash = await hashText(String(entry.content ?? ""));
    if (typeof oldHash === "string" && currentHash !== oldHash) {
      result.push(entry);
      conflicts.push(`${entryName(entry, key)}（玩家已修改，未自动删除）`);
    }
  }

  await updateWorldbookWith(target, () => result);
  return { incoming, result, conflicts };
}
