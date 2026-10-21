export async function hashText(value: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }
    return `fallback-${hash}`;
  }
}

export function worldbookEntries(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter(item => item && typeof item === "object") as Record<string, unknown>[];
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.entries)) return record.entries.filter(item => item && typeof item === "object") as Record<string, unknown>[];
  if (record.entries && typeof record.entries === "object") {
    return Object.values(record.entries as Record<string, unknown>).filter(item => item && typeof item === "object") as Record<string, unknown>[];
  }
  return [];
}

export function regexEntries(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter(item => item && typeof item === "object") as Record<string, unknown>[];
  if (!raw || typeof raw !== "object") return [];
  for (const key of ["regex_scripts", "regexScripts", "scripts", "entries"]) {
    const value = (raw as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.filter(item => item && typeof item === "object") as Record<string, unknown>[];
  }
  return [raw as Record<string, unknown>];
}

export function entryKey(entry: Record<string, unknown>, index: number): string {
  const extension = entry.extensions && typeof entry.extensions === "object"
    ? entry.extensions as Record<string, unknown>
    : {};
  const marker = extension.cw_entry_key ?? entry.uid ?? extension.cw_entry_id;
  if (marker === undefined || marker === null) return `index:${index}`;
  const value = String(marker);
  return value.startsWith("uid:") ? value : `uid:${value}`;
}

export function entryName(entry: Record<string, unknown>, key: string): string {
  for (const value of [entry.comment, entry.name]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return key;
}

export function projectEntry(entry: Record<string, unknown>): boolean {
  const extensions = entry.extensions;
  if (!extensions || typeof extensions !== "object") return false;
  const values: Record<string, unknown> = extensions as Record<string, unknown>;
  return typeof values.cw_project_id === "string";
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
