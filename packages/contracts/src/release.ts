import { z } from "zod";
import { includedTypesSchema, projectTagsSchema, projectTypeSchema } from "./projects.js";

export const releaseFileSchema = z.object({
  kind: z.enum(["worldbook", "regex"]),
  sha256: z.string(),
  bytes: z.number().int().nonnegative(),
  mime: z.string(),
});

export type ReleaseFile = z.infer<typeof releaseFileSchema>;

export const releaseManifestSchema = z.object({
  versionId: z.string(),
  manifestHash: z.string().nullable(),
  files: z.array(releaseFileSchema),
});

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const downloadFileSchema = z.object({
  kind: z.enum(["worldbook", "regex"]),
  url: z.string(),
});

export const downloadResponseSchema = z.object({
  versionId: z.string(),
  files: z.array(downloadFileSchema),
});

export type DownloadResponse = z.infer<typeof downloadResponseSchema>;

export const acquisitionProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectType: projectTypeSchema,
  includedTypes: includedTypesSchema,
  version: z.string(),
  manifestHash: z.string().nullable(),
  updatedAt: z.string(),
  tags: projectTagsSchema,
});

export const acquisitionResponseSchema = z.object({
  project: acquisitionProjectSchema,
  release: releaseManifestSchema,
  downloads: z.array(downloadFileSchema),
});

export type AcquisitionResponse = z.infer<typeof acquisitionResponseSchema>;
