import { installRegexes, regexFingerprint } from "./install-regex.js";
import {
  type InstallFileSet,
  type InstallProject,
  type InstallRegistry,
  type InstallRegistryEntry,
  type InstallScanState,
  readRegistry,
  writeRegistry,
} from "./install-registry.js";
import { ensureTargetWorldbook, installWorldbook, removePreviousWorldbook } from "./install-worldbook.js";
import { entryKey, entryName, hashText } from "./lib.js";

export async function installProject(project: InstallProject, files: InstallFileSet, targetWorldbook?: string | null) {
  if (!project?.id) throw new Error("缺少项目 ID");
  const registry = readRegistry();
  const previous = registry[project.id];
  const target = await ensureTargetWorldbook(targetWorldbook);

  await removePreviousWorldbook(project.id, previous, target);
  const { incoming, result, conflicts } = await installWorldbook(project, files.worldbook, target);
  const { regexIds, regexHashes } = await installRegexes(project, files.regex, previous);

  const entryIndex: InstallRegistryEntry["entries"] = {};
  for (const [index, entry] of result.entries()) {
    if (entry?.extensions?.cw_project_id === project.id) {
      const key = entryKey(entry, index);
      entryIndex[key] = {
        hash: await hashText(String(entry.content ?? "")),
        name: entryName(entry, key),
      };
    }
  }
  registry[project.id] = {
    version: project.version ?? "",
    worldbookName: target,
    entries: entryIndex,
    regexIds,
    regexHashes,
    updatedAt: new Date().toISOString(),
  };
  await writeRegistry(registry);
  return { target, entryCount: incoming.length, regexCount: regexIds.length, conflicts };
}

export async function uninstallProject(projectId: string) {
  const registry = readRegistry();
  const record = registry[projectId];
  let preservedEntries = 0;
  let preservedRegexes = 0;

  if (record?.worldbookName && getWorldbookNames().includes(record.worldbookName)) {
    const current = await getWorldbook(record.worldbookName);
    const kept: WorkshopWorldbookEntry[] = [];
    for (const entry of current) {
      if (entry?.extensions?.cw_project_id !== projectId) {
        kept.push(entry);
        continue;
      }
      const installedHash = entry.extensions.cw_installed_hash;
      const currentHash = await hashText(String(entry.content ?? ""));
      if (typeof installedHash === "string" && currentHash !== installedHash) {
        kept.push(entry);
        preservedEntries += 1;
      }
    }
    await updateWorldbookWith(record.worldbookName, () => kept);
  }

  if (record?.regexIds?.length) {
    const ids = new Set(record.regexIds);
    const all = getTavernRegexes({ scope: "character", enable_state: "all" });
    const kept: WorkshopTavernRegex[] = [];
    for (const regex of all) {
      const id = String(regex.id ?? "");
      if (!ids.has(id)) {
        kept.push(regex);
        continue;
      }
      const installedHash = record.regexHashes?.[id];
      const currentHash = await hashText(regexFingerprint(regex));
      if (installedHash && currentHash !== installedHash) {
        kept.push(regex);
        preservedRegexes += 1;
      }
    }
    await updateTavernRegexesWith(() => kept, { scope: "character" });
  }

  delete registry[projectId];
  await writeRegistry(registry);
  return { removed: Boolean(record), preservedEntries, preservedRegexes };
}

export async function scanInstallStates(registry: InstallRegistry): Promise<Record<string, InstallScanState>> {
  const states: Record<string, InstallScanState> = {};
  const regexes = getTavernRegexes({ scope: "character", enable_state: "all" });
  const regexById = new Map(regexes.map((regex) => [String(regex.id ?? ""), regex]));
  for (const [projectId, record] of Object.entries(registry)) {
    try {
      if (!record.worldbookName || !getWorldbookNames().includes(record.worldbookName)) {
        states[projectId] = "scanIncomplete";
        continue;
      }
      const entries = await getWorldbook(record.worldbookName);
      const entryByKey = new Map<string, WorkshopWorldbookEntry>();
      for (const [index, entry] of entries.entries()) entryByKey.set(entryKey(entry, index), entry);
      let changed = false;
      for (const [key, expected] of Object.entries(record.entries)) {
        const entry = entryByKey.get(key);
        if (!entry) {
          changed = true;
          break;
        }
        if ((await hashText(String(entry.content ?? ""))) !== expected.hash) {
          changed = true;
          break;
        }
      }
      for (const id of record.regexIds) {
        if (changed) break;
        const regex = regexById.get(id);
        const expected = record.regexHashes?.[id];
        if (!regex || !expected) {
          states[projectId] = "scanIncomplete";
          break;
        }
        if ((await hashText(regexFingerprint(regex))) !== expected) {
          changed = true;
          break;
        }
      }
      if (states[projectId]) continue;
      states[projectId] = changed ? "localChanged" : "clean";
    } catch {
      states[projectId] = "scanIncomplete";
    }
  }
  return states;
}
