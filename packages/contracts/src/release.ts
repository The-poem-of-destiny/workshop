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

export const acquisitionProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectType: z.string().nullable(),
  extensionType: z.string().nullable(),
  version: z.string(),
  manifestHash: z.string().nullable(),
  updatedAt: z.string(),
  tags: z.array(z.string()),
});

export const acquisitionResponseSchema = z.object({
  project: acquisitionProjectSchema,
  release: releaseManifestSchema,
  tickets: z.array(downloadTicketFileSchema),
});

export type AcquisitionResponse = z.infer<typeof acquisitionResponseSchema>;
