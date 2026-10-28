type Row = Record<string, unknown>;
export function characterRegexHost(
  get: (options: { type: "character"; enable_state: "all" }) => Row[],
  update: (updater: (rows: Row[]) => Row[], options: { type: "character" }) => Promise<unknown>,
) {
  return {
    regex: () => get({ type: "character", enable_state: "all" }),
    updateRegex: (updater: (rows: Row[]) => Row[]) => update(updater, { type: "character" }),
  };
}
