type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
const implicit: Row = {
  addMemo: true,
  matchPersonaDescription: false,
  matchCharacterDescription: false,
  matchCharacterPersonality: false,
  matchCharacterDepthPrompt: false,
  matchScenario: false,
  matchCreatorNotes: false,
  group: "",
  groupOverride: false,
  groupWeight: 100,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: "",
  ignoreBudget: false,
  outletName: "",
  triggers: [],
  characterFilter: { isExclude: false, names: [], tags: [] },
};
function keywords(value: unknown) {
  return (Array.isArray(value) ? value : []).map((item) => {
    if (item instanceof RegExp) return item;
    const text = String(item);
    const match = /^\/(.*)\/([a-z]*)$/.exec(text);
    if (match) {
      try {
        return new RegExp(match[1]!, match[2]);
      } catch {
        /* Keep a literal keyword when it is not a valid regexp. */
      }
    }
    return text;
  });
}
// TavernHelper worldbook.ts fromWorldbookEntry/toWorldbookEntry projection.
export function projectWorldbook(row: Row) {
  const strategy = object(row.strategy),
    position = object(row.position),
    recursion = object(row.recursion),
    effect = object(row.effect);
  const secondary = object(strategy.keys_secondary);
  const positive = (value: unknown) => (typeof value === "number" && value > 0 ? value : null);
  const result: Row = {
    uid: row.uid,
    name: row.name ?? row.comment ?? "",
    enabled: row.enabled ?? (row.disable === undefined ? true : !row.disable),
    strategy: {
      type:
        strategy.type ??
        (row.constant === undefined || row.constant ? "constant" : row.vectorized ? "vectorized" : "selective"),
      keys: keywords(strategy.keys ?? row.key),
      keys_secondary: {
        logic: secondary.logic ?? ["and_any", "not_all", "not_any", "and_all"][Number(row.selectiveLogic)] ?? "and_any",
        keys: keywords(secondary.keys ?? row.keysecondary),
      },
      scan_depth: strategy.scan_depth ?? row.scanDepth ?? "same_as_global",
    },
    position: {
      type:
        position.type ??
        [
          "before_character_definition",
          "after_character_definition",
          "before_author_note",
          "after_author_note",
          "at_depth",
          "before_example_messages",
          "after_example_messages",
          "outlet",
        ][Number(row.position)] ??
        "at_depth",
      role: position.role ?? "system",
      depth: position.depth ?? row.depth ?? 4,
      order: position.order ?? row.order ?? 100,
    },
    content: row.content ?? "",
    probability: row.probability ?? 100,
    recursion: {
      prevent_incoming: recursion.prevent_incoming ?? row.excludeRecursion ?? false,
      prevent_outgoing: recursion.prevent_outgoing ?? row.preventRecursion ?? false,
      delay_until: positive(recursion.delay_until ?? row.delayUntilRecursion),
    },
    effect: {
      sticky: positive(effect.sticky ?? row.sticky),
      cooldown: positive(effect.cooldown ?? row.cooldown),
      delay: positive(effect.delay ?? row.delay),
    },
  };
  if (row.extra) result.extra = row.extra;
  for (const [key, value] of Object.entries(implicit)) result[key] = row[key] ?? structuredClone(value);
  return result;
}
// TavernHelper only persists these explicit TavernRegex fields (no extensions/scope).
export function projectRegex(row: Row): Row {
  const source = object(row.source),
    destination = object(row.destination);
  return {
    id: row.id,
    script_name: row.script_name,
    enabled: Boolean(row.enabled),
    find_regex: row.find_regex,
    replace_string: row.replace_string,
    trim_strings: row.trim_strings || [],
    source: Object.fromEntries(
      ["user_input", "ai_output", "slash_command", "world_info", "reasoning"].map((key) => [key, Boolean(source[key])]),
    ),
    destination: { display: Boolean(destination.display), prompt: Boolean(destination.prompt) },
    run_on_edit: Boolean(row.run_on_edit),
    min_depth: typeof row.min_depth === "number" ? row.min_depth : null,
    max_depth: typeof row.max_depth === "number" ? row.max_depth : null,
  };
}
