import { detectCurrentScriptUrl, normalizeWorkshopOrigin, resolveScriptRuntime } from "./lib.js";

const ORIGIN_VARIABLE = "cw_worker_origin";

export const SCRIPT_RUNTIME = (() => {
  try {
    const script = typeof document !== "undefined" ? document.currentScript : null;
    const src = script instanceof HTMLScriptElement ? script.src : null;
    return resolveScriptRuntime(detectCurrentScriptUrl(src, new Error().stack), __CW_DEFAULT_ORIGIN__);
  } catch {
    return { channel: "stable" as const, defaultOrigin: __CW_DEFAULT_ORIGIN__ };
  }
})();

export function scriptVariables(): Record<string, unknown> {
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
  return normalizeWorkshopOrigin(variables[ORIGIN_VARIABLE], SCRIPT_RUNTIME.defaultOrigin);
}
