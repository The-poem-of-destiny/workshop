export const WORKSHOP_LIMITS = {
  projectUploadBytes: 10 * 1024 * 1024,
  projectUploadLabel: "10MB",
  projectImageUploadBytes: 1024 * 1024,
  projectImageUploadLabel: "1MiB",
  coverRequestOverheadBytes: 1024 * 1024,
  coverMaxDimension: 4096,
  bannerUploadBytes: 2 * 1024 * 1024,
  bannerUploadLabel: "2 MiB",
  projectBatchMaxIds: 50,
  projectBatchMaxIdLength: 80,
} as const;

export function normalizeProjectBatchIds(ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  if (ids.length > WORKSHOP_LIMITS.projectBatchMaxIds || ids.some((id) => id.includes(","))) {
    throw new Error("Invalid project batch IDs");
  }
  const normalized = ids.map((id) => id.trim());
  if (normalized.some((id) => id.length === 0 || id.length > WORKSHOP_LIMITS.projectBatchMaxIdLength)) {
    throw new Error("Invalid project batch IDs");
  }
  return [...new Set(normalized)].sort();
}
