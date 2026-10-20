import { z } from "zod";
import { extensionTypeSchema, projectSummarySchema, projectTypeSchema } from "./projects.js";
import { visibilitySchema } from "./identity.js";

const optionalText = z.string().max(100_000).nullable().optional();
const tagsSchema = z.array(z.string().min(1).max(100)).max(100).optional();

export const projectMetadataSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText,
  authorNote: optionalText,
  projectType: projectTypeSchema.nullable().optional(),
  extensionType: extensionTypeSchema.nullable().optional(),
  tags: tagsSchema,
});
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;

export const createProjectSchema = projectMetadataSchema;
export type CreateProject = z.infer<typeof createProjectSchema>;

export const patchProjectSchema = projectMetadataSchema.partial();
export type PatchProject = z.infer<typeof patchProjectSchema>;

export const visibilityUpdateSchema = z.object({ visibility: visibilitySchema });
export type VisibilityUpdate = z.infer<typeof visibilityUpdateSchema>;

export const uploadKindSchema = z.enum(["worldbook", "regex", "cover"]);
export type UploadKind = z.infer<typeof uploadKindSchema>;

export const submitProjectSchema = z.object({
  gate: z.enum(["pass", "warn", "block", "missing"]),
  checkerRevision: z.string().min(1).max(200).optional(),
});
export type SubmitProject = z.infer<typeof submitProjectSchema>;

export const authoringProjectResponseSchema = z.object({
  project: projectSummarySchema,
  rowVersion: z.number().int().positive(),
  workingRevisionId: z.string(),
});
export type AuthoringProjectResponse = z.infer<typeof authoringProjectResponseSchema>;

export const authoringRevisionResponseSchema = z.object({
  rowVersion: z.number().int().positive(),
  revisionId: z.string(),
});
export type AuthoringRevisionResponse = z.infer<typeof authoringRevisionResponseSchema>;

export const uploadResponseSchema = z.object({
  kind: uploadKindSchema,
  sha256: z.string().length(64),
  bytes: z.number().int().nonnegative(),
  mime: z.string(),
  r2Key: z.string(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const submitResponseSchema = z.object({
  submissionId: z.string(),
  status: z.literal("pending"),
});
export type SubmitResponse = z.infer<typeof submitResponseSchema>;
