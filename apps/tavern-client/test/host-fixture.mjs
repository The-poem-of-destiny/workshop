// Independently model the explicit TH from/to projections: unsupported fields never survive.
export function worldbook(row) {
  const s = row.strategy ?? {},
    p = row.position ?? {},
    r = row.recursion ?? {},
    e = row.effect ?? {};
  const keys = (values) =>
    (values ?? []).map((value) => {
      const text = String(value),
        m = /^\/(.*)\/([a-z]*)$/.exec(text);
      if (m) {
        try {
          return new RegExp(m[1], m[2]);
        } catch {}
      }
      return text;
    });
  const positive = (value) => (typeof value === "number" && value > 0 ? value : null);
  const result = {
    uid: row.uid,
    name: row.name ?? "",
    enabled: row.enabled ?? true,
    strategy: {
      type: s.type ?? "constant",
      keys: keys(s.keys),
      keys_secondary: { logic: s.keys_secondary?.logic ?? "and_any", keys: keys(s.keys_secondary?.keys) },
      scan_depth: s.scan_depth ?? "same_as_global",
    },
    position: { type: p.type ?? "at_depth", role: p.role ?? "system", depth: p.depth ?? 4, order: p.order ?? 100 },
    content: row.content ?? "",
    probability: row.probability ?? 100,
    recursion: {
      prevent_incoming: r.prevent_incoming ?? false,
      prevent_outgoing: r.prevent_outgoing ?? false,
      delay_until: positive(r.delay_until),
    },
    effect: { sticky: positive(e.sticky), cooldown: positive(e.cooldown), delay: positive(e.delay) },
  };
  if (row.extra) result.extra = structuredClone(row.extra);
  const defaults = {
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
  for (const [key, value] of Object.entries(defaults)) result[key] = structuredClone(row[key] ?? value);
  return result;
}
export function regex(row) {
  const source = {},
    destination = {};
  for (const key of ["user_input", "ai_output", "slash_command", "world_info", "reasoning"])
    source[key] = Boolean(row.source?.[key]);
  for (const key of ["display", "prompt"]) destination[key] = Boolean(row.destination?.[key]);
  return {
    id: row.id,
    script_name: row.script_name,
    enabled: Boolean(row.enabled),
    find_regex: row.find_regex,
    trim_strings: row.trim_strings || [],
    replace_string: row.replace_string,
    source,
    destination,
    run_on_edit: Boolean(row.run_on_edit),
    min_depth: typeof row.min_depth === "number" ? row.min_depth : null,
    max_depth: typeof row.max_depth === "number" ? row.max_depth : null,
  };
}
