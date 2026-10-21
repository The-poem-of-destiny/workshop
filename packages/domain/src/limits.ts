export const WORKSHOP_LIMITS = {
  projectUploadBytes: 10 * 1024 * 1024,
  projectUploadLabel: "10MB",
  coverRequestOverheadBytes: 1024 * 1024,
  coverMaxDimension: 4096,
  bannerUploadBytes: 8 * 1024 * 1024,
  bannerUploadLabel: "8 MB",
  downloadTicketTtlMs: 5 * 60 * 1000,
} as const;
