import { z } from "zod";
import { roleSchema } from "./identity.js";

export const adminSubmissionStatusSchema = z.enum([
  "pending",
  "checking",
  "approved",
  "rejected",
  "superseded",
]);
export type AdminSubmissionStatus = z.infer<typeof adminSubmissionStatusSchema>;

export const adminSubmissionListQuerySchema = z.object({
  status: adminSubmissionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
});
export type AdminSubmissionListQuery = z.infer<typeof adminSubmissionListQuerySchema>;

export const adminReviewRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(4000).optional(),
}).superRefine((value, ctx) => {
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

export const adminSubmissionListResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    projectId: z.string(),
    projectTitle: z.string(),
    author: z.object({ id: z.string(), name: z.string() }),
    status: adminSubmissionStatusSchema,
    gate: z.string().nullable(),
    checkerRevision: z.string().nullable(),
    submittedAt: z.string(),
  })),
  nextCursor: z.string().nullable(),
});

export type AdminAsset = z.infer<typeof adminAssetSchema>;
export type AdminReview = z.infer<typeof adminReviewSchema>;
export type AdminSubmissionListResponse = z.infer<typeof adminSubmissionListResponseSchema>;
