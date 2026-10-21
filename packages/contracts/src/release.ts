import { z } from "zod";

export const releaseFileSchema = z.object({
  kind: z.enum(["worldbook", "regex"]),
  sha256: z.string(),
  bytes: z.number().int().nonnegative(),
  mime: z.string(),
});

export type ReleaseFile = z.infer<typeof releaseFileSchema>;

export const releaseManifestSchema = z.object({
  revisionId: z.string(),
  manifestHash: z.string().nullable(),
  files: z.array(releaseFileSchema),
});

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const downloadTicketFileSchema = z.object({
  kind: z.enum(["worldbook", "regex"]),
  url: z.string(),
  expiresAt: z.string().datetime(),
});

export const downloadTicketResponseSchema = z.object({
  revisionId: z.string(),
  files: z.array(downloadTicketFileSchema),
});

export type DownloadTicketResponse = z.infer<typeof downloadTicketResponseSchema>;
