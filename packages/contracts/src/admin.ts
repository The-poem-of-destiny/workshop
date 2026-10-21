import { z } from "zod";
import { roleSchema } from "./identity.js";

export const adminSubmissionStatusSchema = z.enum(["pending", "checking", "approved", "rejected", "superseded"]);
export type AdminSubmissionStatus = z.infer<typeof adminSubmissionStatusSchema>;

export const adminSubmissionListQuerySchema = z.object({
  status: z.preprocess(
    (value) =>
      typeof value === "string"
        ? value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : value,
    z.array(adminSubmissionStatusSchema).min(1).max(5).optional(),
  ),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
});
export type AdminSubmissionListQuery = z.infer<typeof adminSubmissionListQuerySchema>;

export const adminReviewRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().max(4000).optional(),
    revisionId: z.string().max(80).optional(),
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
export type AdminRoleRequest = z.infer<typeof adminRoleRequestSchema>;

export const adminListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  projectType: z.string().max(40).optional(),
  includeDeleted: z.boolean().optional(),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

export const adminAssetSchema = z.object({
  id: z.string(),
  kind: z.string(),
  sha256: z.string(),
  bytes: z.number().int().nonnegative(),
  mime: z.string(),
  r2Key: z.string(),
});

export const adminReviewSchema = z.object({
  id: z.string(),
  submissionId: z.string(),
  reviewerId: z.string(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().nullable(),
  manifestHash: z.string().nullable(),
  checkerVersion: z.string().nullable(),
  report: z.unknown().nullable(),
  createdAt: z.string(),
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
      checkerRevision: z.string().nullable(),
      checkStatus: z.enum(["queued", "running", "done", "needs_human", "failed"]),
      submittedAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export type AdminAsset = z.infer<typeof adminAssetSchema>;
export type AdminReview = z.infer<typeof adminReviewSchema>;
export type AdminSubmissionListResponse = z.infer<typeof adminSubmissionListResponseSchema>;
export const adminAuditEventListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
  action: z.string().max(200).optional(),
});
export type AdminAuditEventListQuery = z.infer<typeof adminAuditEventListQuerySchema>;

const adminBannerWriteSchema = z.object({
  imageUrl: z.string().nullable(),
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
export type AdminSiteUpdate = z.infer<typeof adminSiteUpdateSchema>;

export const adminRecommendationUpdateSchema = z.object({
  comment: z.string().max(2000).optional(),
  reaction: z.string().max(100).optional(),
});
export type AdminRecommendationUpdate = z.infer<typeof adminRecommendationUpdateSchema>;

const adminReferenceItemSchema = z.object({
  kind: z.enum(["worldbook", "regex"]),
  displayName: z.string().min(1).max(500),
  sourceKey: z.string().max(1000).nullable().optional(),
  exactHash: z.string().optional(),
  normalizedContentHash: z.string().optional(),
  nameHash: z.string().optional(),
  keysHash: z.string().nullable().optional(),
  structureHash: z.string().optional(),
});

export const adminReferenceSetUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  versionLabel: z.string().min(1).max(200).optional(),
  items: z.array(adminReferenceItemSchema).optional(),
});
export type AdminReferenceSetUpdate = z.infer<typeof adminReferenceSetUpdateSchema>;

export const adminReferenceSetCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  versionLabel: z.string().min(1).max(200),
  graceUntil: z.string().datetime().optional(),
  items: z.array(adminReferenceItemSchema).default([]),
});
export type AdminReferenceSetCreate = z.infer<typeof adminReferenceSetCreateSchema>;

export const adminReferenceVersionCreateSchema = z.object({
  versionLabel: z.string().min(1).max(200),
  graceUntil: z.string().datetime().optional(),
  items: z.array(adminReferenceItemSchema).default([]),
});
export type AdminReferenceVersionCreate = z.infer<typeof adminReferenceVersionCreateSchema>;
