import { z } from "zod";
import { auditActionSchema } from "./audit.js";
import { roleSchema } from "./identity.js";
import { projectTypeSchema } from "./projects.js";

export const adminSubmissionStatusSchema = z.enum(["pending", "checking", "approved", "rejected", "superseded"]);
export type AdminSubmissionStatus = z.infer<typeof adminSubmissionStatusSchema>;

export const adminSubmissionListQuerySchema = z.object({
  status: z
    .union([
      z
        .string()
        .max(128)
        .transform((value) =>
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      z.array(adminSubmissionStatusSchema).max(5),
    ])
    .pipe(z.array(adminSubmissionStatusSchema).min(1).max(5))
    .default(["pending"]),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
});
export type AdminSubmissionListQuery = z.infer<typeof adminSubmissionListQuerySchema>;

export const adminReviewRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().max(4000).optional(),
    versionId: z.string().max(80).optional(),
    manifestHash: z.string().max(128).optional(),
    reportHash: z.string().max(128).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "reject" && !value.reason?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "拒绝时必须填写理由",
      });
    }
  });
export type AdminReviewRequest = z.infer<typeof adminReviewRequestSchema>;

export const adminRoleRequestSchema = z.object({ role: roleSchema });

export const adminListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  projectType: projectTypeSchema.optional(),
  includeDeleted: z.boolean().optional(),
});

export const adminSubmissionCountsSchema = z.object({
  pending: z.number(),
  checking: z.number(),
  approved: z.number(),
  rejected: z.number(),
  superseded: z.number(),
});

export const adminSubmissionListResponseSchema = z.object({
  counts: adminSubmissionCountsSchema,
  items: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      projectTitle: z.string(),
      author: z.object({ id: z.string(), name: z.string() }),
      status: adminSubmissionStatusSchema,
      gate: z.string().nullable(),
      checkerVersion: z.string().nullable(),
      checkStatus: z.enum(["queued", "running", "done", "needs_human", "failed"]),
      submittedAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export type AdminSubmissionListResponse = z.infer<typeof adminSubmissionListResponseSchema>;
export const adminAuditEventListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
  action: auditActionSchema.optional(),
});

const adminBannerWriteSchema = z.object({
  imageUrl: z.string().max(2048).nullable(),
  positionX: z.number().min(0).max(100),
  positionY: z.number().min(0).max(100),
  zoom: z.number().min(1).max(3),
  mobilePositionX: z.number().min(0).max(100),
  mobilePositionY: z.number().min(0).max(100),
  mobileZoom: z.number().min(1).max(3),
});

export const adminSiteUpdateSchema = z.object({
  banner: adminBannerWriteSchema.optional(),
  siteContent: z.unknown().optional(),
});

export const adminRecommendationUpdateSchema = z.object({
  comment: z.string().max(2000).optional(),
  projectVersionId: z.string().min(1),
});
