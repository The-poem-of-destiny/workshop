export function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function encodeCursor(offset: number): string {
  return btoa(String(offset));
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const offset = Number(atob(cursor));
    return Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}
