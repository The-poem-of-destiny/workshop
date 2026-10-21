export const PROJECT_VERSION_BUMPS = ["patch", "minor", "major"] as const;
export type ProjectVersionBump = (typeof PROJECT_VERSION_BUMPS)[number];
export const LEGACY_PROJECT_VERSION_BASE = "1.0.0";

export interface ParsedProjectVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseProjectVersion(value: unknown): ParsedProjectVersion | null {
  const text = String(value ?? "").trim();
  const match = text.match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;

  return { major, minor, patch };
}

export function compareProjectVersions(left: unknown, right: unknown): number | null {
  const a = parseProjectVersion(left);
  const b = parseProjectVersion(right);
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
}

export function bumpProjectVersion(value: unknown, bump: ProjectVersionBump = "patch"): string {
  const parsed = parseProjectVersion(value);
  if (!parsed) {
    throw new Error(`Invalid project version: ${String(value ?? "")}. Expected X.Y.Z.`);
  }
  if (!PROJECT_VERSION_BUMPS.includes(bump)) {
    throw new Error(`Invalid project version bump: ${String(bump)}`);
  }

  if (bump === "major") return `${parsed.major + 1}.0.0`;
  if (bump === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

export function normalizeProjectVersionBase(value: unknown): string {
  const parsed = parseProjectVersion(value);
  if (!parsed) return LEGACY_PROJECT_VERSION_BASE;
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

export function bumpProjectVersionWithLegacyFallback(value: unknown, bump: ProjectVersionBump = "patch"): string {
  return bumpProjectVersion(normalizeProjectVersionBase(value), bump);
}
