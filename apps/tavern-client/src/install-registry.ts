import { normalizeWorkshopOrigin } from "./lib.js";

const DEFAULT_ORIGIN = __CW_DEFAULT_ORIGIN__;
const ORIGIN_VARIABLE = "cw_worker_origin";
const REGISTRY_VARIABLE = "cw_install_registry";

export type InstallFileSet = { worldbook?: string; regex?: string };
export type InstallProject = { id: string; title?: string; version?: string; projectType?: string | null };
export type InstallRegistryEntry = {
  version: string;
  worldbookName: string;
  entries: Record<string, { hash: string; name: string }>;
  regexIds: string[];
  regexHashes?: Record<string, string>;
  updatedAt: string;
};
export type InstallRegistry = Record<string, InstallRegistryEntry>;
export type InstallScanState = "clean" | "localChanged" | "scanIncomplete";

function scriptVariables(): Record<string, unknown> {
  try {
    return getVariables({ type: "script", script_id: getScriptId() }) ?? {};
  } catch {
    return {};
  }
}

export async function saveScriptVariables(updater: (variables: Record<string, unknown>) => void): Promise<void> {
  await updateVariablesWith(
    (variables) => {
      updater(variables);
      return variables;
    },
    { type: "script", script_id: getScriptId() },
  );
}

export function workshopOrigin(): string {
  const variables = scriptVariables();
  return normalizeWorkshopOrigin(variables[ORIGIN_VARIABLE], DEFAULT_ORIGIN);
}

export function readRegistry(): InstallRegistry {
  const raw = scriptVariables()[REGISTRY_VARIABLE];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as InstallRegistry) : {};
}

export async function writeRegistry(registry: InstallRegistry): Promise<void> {
  await saveScriptVariables((variables) => {
    variables[REGISTRY_VARIABLE] = registry;
  });
}
