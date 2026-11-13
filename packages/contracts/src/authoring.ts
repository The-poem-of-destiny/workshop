import { parseDiscordThreadUrl } from "@workshop/domain";
import { z } from "zod";
import { visibilitySchema } from "./identity.js";
import {
  includedTypesSchema,
  projectSummarySchema,
  projectTagsSchema,
  projectTaxonomySchema,
  projectTypeSchema,
} from "./projects.js";
import { requirementsSchema } from "./requirements.js";

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

const projectMetadataFields = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText,
  projectType: projectTypeSchema,
  includedTypes: includedTypesSchema.default([]),
  schemaVersion: z.string().trim().max(32).nullable().optional(),
  versionLabel: z.string().trim().max(80).nullable().optional(),
  requirements: requirementsSchema.nullable().optional(),
  coverPositionX: z.number().min(0).max(100).optional(),
  coverPositionY: z.number().min(0).max(100).optional(),
  coverZoom: z.number().min(1).max(3).optional(),
  discordThreadUrl: discordThreadUrlSchema,
  tags: projectTagsSchema.default([]),
}).strict();

export const projectMetadataSchema = projectMetadataFields.superRefine((value, ctx) => {
  const taxonomy = projectTaxonomySchema.safeParse(value);
  if (!taxonomy.success) for (const issue of taxonomy.error.issues) ctx.addIssue(issue);
});
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;

export const createProjectSchema = projectMetadataSchema;
export type CreateProject = z.infer<typeof createProjectSchema>;

export const patchProjectSchema = projectMetadataFields.partial().extend({
  includedTypes: includedTypesSchema.optional(),
  tags: projectTagsSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.projectType && value.includedTypes?.includes(value.projectType)) {
    ctx.addIssue({ code: "custom", path: ["includedTypes"], message: "包含分类不能与主分类相同" });
  }
});
export type PatchProject = z.infer<typeof patchProjectSchema>;

export const visibilityUpdateSchema = z.object({ visibility: visibilitySchema });
export type VisibilityUpdate = z.infer<typeof visibilityUpdateSchema>;

export const uploadKindSchema = z.enum(["worldbook", "regex", "cover"]);
export type UploadKind = z.infer<typeof uploadKindSchema>;

export const submitProjectSchema = z.object({
  gate: z.enum(["pass", "warn", "block", "missing"]).optional(),
  checkerVersion: z.string().min(1).max(200).optional(),
  warningCount: z.number().int().min(0).max(10_000).default(0),
  acknowledged: z.boolean().optional(),
});
export type SubmitProject = z.infer<typeof submitProjectSchema>;

export const authoringProjectResponseSchema = z.object({
  project: projectSummarySchema,
  rowVersion: z.number().int().positive(),
  workingVersionId: z.string(),
});
export type AuthoringProjectResponse = z.infer<typeof authoringProjectResponseSchema>;

export const authoringVersionResponseSchema = z.object({
  rowVersion: z.number().int().positive(),
  versionId: z.string(),
});
export type AuthoringVersionResponse = z.infer<typeof authoringVersionResponseSchema>;

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
  versionId: z.string(),
  status: z.enum(["pending", "checking", "approved", "rejected", "superseded"]),
  gate: z.string().nullable(),
  checkerVersion: z.string().nullable(),
  submittedAt: z.string(),
  resolvedAt: z.string().nullable(),
  withdrawnAt: z.string().nullable().default(null),
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
  workingVersionId: z.string().nullable(),
  latestSubmission: authorSubmissionSchema.nullable(),
  requirements: requirementsSchema.nullable().optional(),
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
