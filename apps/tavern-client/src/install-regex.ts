import type { InstallProject, InstallRegistryEntry } from "./install-registry.js";
import { hashText, regexEntries } from "./lib.js";

export function regexFingerprint(regex: WorkshopTavernRegex): string {
  return JSON.stringify({
    find: regex.find_regex ?? "",
    replace: regex.replace_string ?? "",
    trim: regex.trim_strings ?? [],
    source: regex.source ?? null,
    destination: regex.destination ?? null,
  });
}

export async function installRegexes(
  project: InstallProject,
  text: string | undefined,
  previous: InstallRegistryEntry | undefined,
) {
  const regexIds: string[] = [];
  const regexHashes: Record<string, string> = {};
  if (text) {
    const incomingRegex = regexEntries(JSON.parse(text));
    const all = getTavernRegexes({ scope: "character", enable_state: "all" });
    const prefix = `cw-${project.id}-`;
    const existing = new Map(all.map((regex) => [String(regex.id ?? ""), regex]));
    const kept = all.filter((regex) => !String(regex.id ?? "").startsWith(prefix));
    const added = incomingRegex.map((entry, index): WorkshopTavernRegex => {
      const id = `${prefix}${index}`;
      regexIds.push(id);
      const old = existing.get(id);
      return {
        id,
        script_name: `[工坊] ${project.title ?? project.id} - ${entry.scriptName ?? entry.script_name ?? entry.id ?? index + 1}`,
        enabled: old?.enabled ?? true,
        scope: "character",
        find_regex: String(entry.findRegex ?? entry.find_regex ?? ""),
        replace_string: String(entry.replaceString ?? entry.replace_string ?? ""),
        trim_strings: Array.isArray(entry.trimStrings) ? entry.trimStrings : [],
        source: Array.isArray(entry.placement)
          ? {
              user_input: entry.placement.includes(1),
              ai_output: entry.placement.includes(2),
              slash_command: entry.placement.includes(3),
              world_info: entry.placement.includes(5),
              reasoning: entry.placement.includes(6),
            }
          : old?.source,
        destination: old?.destination ?? {
          display: Boolean(entry.markdownOnly),
          prompt: Boolean(entry.promptOnly),
        },
        run_on_edit: Boolean(entry.runOnEdit),
        min_depth: typeof entry.minDepth === "number" && Number.isFinite(entry.minDepth) ? entry.minDepth : null,
        max_depth: typeof entry.maxDepth === "number" && Number.isFinite(entry.maxDepth) ? entry.maxDepth : null,
      };
    });
    for (const regex of added) {
      regexHashes[String(regex.id)] = await hashText(regexFingerprint(regex));
    }
    await updateTavernRegexesWith(() => [...kept, ...added], { scope: "character" });
  } else if (previous?.regexIds?.length) {
    const prefix = `cw-${project.id}-`;
    await updateTavernRegexesWith((regexes) => regexes.filter((regex) => !String(regex.id ?? "").startsWith(prefix)), {
      scope: "character",
    });
  }
  return { regexIds, regexHashes };
}
