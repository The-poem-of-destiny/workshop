export function ifMatchVersion(value: string | undefined): number | null {
  if (!value) return null;
  const unquoted = value.trim().replace(/^"|"$|^'|'$/g, "");
  const parsed = Number(unquoted);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
