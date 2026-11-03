export const WORKSHOP_LIMITS = {
  projectUploadBytes: 10 * 1024 * 1024,
  projectUploadLabel: "10MB",
  projectImageUploadBytes: 1024 * 1024,
  projectImageUploadLabel: "1MiB",
  coverRequestOverheadBytes: 1024 * 1024,
  coverMaxDimension: 4096,
  bannerUploadBytes: 2 * 1024 * 1024,
  bannerUploadLabel: "2 MiB",
} as const;
