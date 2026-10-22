import { parseDiscordThreadUrl } from "@workshop/domain";
import { z } from "zod";
import { visibilitySchema } from "./identity.js";
import { extensionTypeSchema, projectSummarySchema, projectTypeSchema } from "./projects.js";

const discordThreadUrlSchema = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .optional()
  .superRefine((value, ctx) => {
    if (!value) return;
    const parsed = parseDiscordThreadUrl(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: `Discord 线程地址无效：${parsed.reason}` });
    }
  });

const optionalText = z.string().max(100_000).nullable().optional();
const tagsSchema = z.array(z.string().min(1).max(100)).max(100).optional();

export const projectMetadataSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText,
  authorNote: optionalText,
  projectType: projectTypeSchema.nullable().optional(),
  extensionType: extensionTypeSchema.nullable().optional(),
  schemaVersion: z.string().trim().max(32).nullable().optional(),
  versionLabel: z.string().trim().max(80).nullable().optional(),
  precautions: z.string().max(2_000).nullable().optional(),
  coverPositionX: z.number().min(0).max(100).optional(),
  coverPositionY: z.number().min(0).max(100).optional(),
  coverZoom: z.number().min(1).max(3).optional(),
  discordThreadUrl: discordThreadUrlSchema,
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
  gate: z.enum(["pass", "warn", "block", "missing"]).optional(),
  checkerRevision: z.string().min(1).max(200).optional(),
  warningCount: z.number().int().min(0).max(10_000).default(0),
  acknowledged: z.boolean().optional(),
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
  rowVersion: z.number().int().positive(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const submitResponseSchema = z.object({
  submissionId: z.string(),
  status: z.enum(["pending", "checking"]),
  checkStatus: z.enum(["queued", "needs_human"]),
  rowVersion: z.number().int().positive(),
});
export type SubmitResponse = z.infer<typeof submitResponseSchema>;

export const authorSubmissionSchema = z.object({
  id: z.string(),
  revisionId: z.string(),
  status: z.enum(["pending", "checking", "approved", "rejected", "superseded"]),
  gate: z.string().nullable(),
  checkerRevision: z.string().nullable(),
  submittedAt: z.string(),
  resolvedAt: z.string().nullable(),
  decision: z.enum(["approve", "reject"]).nullable(),
  reason: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  checkStatus: z.enum(["queued", "running", "done", "needs_human", "failed"]),
  checkError: z.string().nullable(),
  checkedAt: z.string().nullable(),
});
export type AuthorSubmission = z.infer<typeof authorSubmissionSchema>;

export const authorProjectSchema = z.object({
  project: projectSummarySchema,
  rowVersion: z.number().int().positive(),
  workingRevisionId: z.string().nullable(),
  latestSubmission: authorSubmissionSchema.nullable(),
  authorNote: z.string().nullable().optional(),
  precautions: z.string().nullable().optional(),
  metadataFindings: z.string().nullable().optional(),
});
export type AuthorProject = z.infer<typeof authorProjectSchema>;

export const authorProjectListResponseSchema = z.object({
  items: z.array(authorProjectSchema),
});
export type AuthorProjectListResponse = z.infer<typeof authorProjectListResponseSchema>;

export const authorSubmissionListResponseSchema = z.object({
  items: z.array(authorSubmissionSchema),
});
export type AuthorSubmissionListResponse = z.infer<typeof authorSubmissionListResponseSchema>;
export const publishedMetadataResponseSchema = z.object({
  rowVersion: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  authorNote: z.string().nullable(),
  projectType: projectTypeSchema.nullable(),
  extensionType: extensionTypeSchema.nullable(),
  schemaVersion: z.string().nullable(),
  discordThreadUrl: z.string().nullable(),
  tags: z.array(z.string()),
  versionLabel: z.string().nullable(),
  precautions: z.string().nullable(),
  coverPositionX: z.number(),
  coverPositionY: z.number(),
  coverZoom: z.number(),
});
export type PublishedMetadataResponse = z.infer<typeof publishedMetadataResponseSchema>;

export const publishedMetadataMutationResponseSchema = z.object({
  rowVersion: z.number().int().positive(),
});
export type PublishedMetadataMutationResponse = z.infer<typeof publishedMetadataMutationResponseSchema>;

export const publishedCoverMutationResponseSchema = z.object({
  rowVersion: z.number().int().positive(),
  sha256: z.string().length(64),
  bytes: z.number().int().positive(),
  mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
});
export type PublishedCoverMutationResponse = z.infer<typeof publishedCoverMutationResponseSchema>;
