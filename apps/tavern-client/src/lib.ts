export function worldbookEntries(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.entries))
    return record.entries.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  if (record.entries && typeof record.entries === "object") {
    return Object.values(record.entries as Record<string, unknown>).filter(
      (item) => item && typeof item === "object",
    ) as Record<string, unknown>[];
  }
  return [];
}

export function regexEntries(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  if (!raw || typeof raw !== "object") return [];
  for (const key of ["regex_scripts", "regexScripts", "scripts", "entries"]) {
    const value = (raw as Record<string, unknown>)[key];
    if (Array.isArray(value))
      return value.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  }
  return [raw as Record<string, unknown>];
}

export function entryKey(entry: { uid?: unknown; extensions?: unknown }, index: number): string {
  const extension =
    entry.extensions && typeof entry.extensions === "object" ? (entry.extensions as Record<string, unknown>) : {};
  const marker = extension.cw_entry_key ?? entry.uid ?? extension.cw_entry_id;
  if (marker === undefined || marker === null) return `index:${index}`;
  const value = String(marker);
  return value.startsWith("uid:") ? value : `uid:${value}`;
}

export function normalizeWorkshopOrigin(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

export function detectCurrentScriptUrl(currentScriptSrc?: string | null, stack?: string): string | null {
  if (typeof currentScriptSrc === "string" && currentScriptSrc.trim()) return currentScriptSrc.trim();
  if (typeof stack === "string") {
    const match = /https?:\/\/[^\s)"']+\/client\/(?:staging|stable|v\/[a-f0-9]+)\/index\.js\b/.exec(stack);
    if (match) return match[0];
  }
  return null;
}

export function resolveScriptRuntime(
  scriptUrl: string | null | undefined,
  fallbackOrigin: string,
): { channel: "stable" | "staging"; defaultOrigin: string } {
  if (typeof scriptUrl === "string" && scriptUrl.trim()) {
    try {
      const url = new URL(scriptUrl.trim());
      if (url.protocol === "https:" || url.protocol === "http:") {
        if (/\/client\/staging\/index\.js$/.test(url.pathname)) {
          return { channel: "staging", defaultOrigin: url.origin };
        }
        if (/\/staging\//.test(url.pathname)) {
          return { channel: "staging", defaultOrigin: fallbackOrigin };
        }
      }
    } catch {
      // Ignore malformed script URLs and fall back to build defaults.
    }
  }
  return { channel: "stable", defaultOrigin: fallbackOrigin };
}
