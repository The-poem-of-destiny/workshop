import { normalizeWorkshopOrigin } from "./lib.js";

const DEFAULT_ORIGIN = __CW_DEFAULT_ORIGIN__;
const ORIGIN_VARIABLE = "cw_worker_origin";

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
  return normalizeWorkshopOrigin(variables[ORIGIN_VARIABLE], DEFAULT_ORIGIN);
}
