import { z } from "zod";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const entryChangeSchema = z.object({
  entryKey: z.string(),
  name: z.string(),
});

export const diffKindSchema = z.object({
  added: z.array(entryChangeSchema),
  modified: z.array(entryChangeSchema.extend({ changedFields: z.array(z.string()).optional() })),
  deleted: z.array(entryChangeSchema),
  unchanged: z.number().int().nonnegative(),
});

export const findingRefSchema = z.object({
  ruleId: z.string(),
  severity: z.string(),
  message: z.string(),
  file: z.string().nullable(),
  line: z.number().nullable(),
});

export const findingDiffSchema = z.object({
  accepted: z.array(findingRefSchema),
  changed: z.array(findingRefSchema),
  added: z.array(findingRefSchema),
  removed: z.array(findingRefSchema),
});

export const submissionDiffSchema = z.object({
  revisionId: z.string(),
  previousRevisionId: z.string().nullable(),
  worldbook: diffKindSchema,
  regex: diffKindSchema,
  cover: z.object({
    changed: z.boolean(),
    beforeSha256: z.string().nullable(),
    afterSha256: z.string().nullable(),
  }),
  findings: findingDiffSchema,
});

export type DiffKind = z.infer<typeof diffKindSchema>;
export type FindingRef = z.infer<typeof findingRefSchema>;
export type FindingDiff = z.infer<typeof findingDiffSchema>;
export type SubmissionDiff = z.infer<typeof submissionDiffSchema>;

export const adminSubmissionDetailSchema = z.object({
  submission: z.object({
    id: z.string(),
    projectId: z.string(),
    revisionId: z.string(),
    status: z.string(),
    submittedBy: z.string(),
    submittedAt: z.string(),
    resolvedAt: z.string().nullable(),
    clientGate: z.string().nullable(),
    clientCheckerRevision: z.string().nullable(),
    clientWarningCount: z.number().int().nullable(),
    clientAcknowledgedAt: z.string().nullable(),
    checkStatus: z.string(),
    checkAttempts: z.number().int(),
    checkError: z.string().nullable(),
    checkReport: jsonValueSchema,
    checkReportHash: z.string().nullable(),
    checkedAt: z.string().nullable(),
    reviewCheckerRevision: z.string().nullable(),
    autoPublishedAt: z.string().nullable(),
  }),
  project: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    visibility: z.string(),
    author: z.object({ id: z.string(), name: z.string() }),
  }),
  revision: z.object({
    id: z.string(),
    revisionNo: z.number().int(),
    title: z.string(),
    description: z.string().nullable(),
    authorNote: z.string().nullable(),
    projectType: z.string().nullable(),
    extensionType: z.string().nullable(),
    searchTags: jsonValueSchema,
    manifestHash: z.string().nullable(),
    createdAt: z.string(),
  }),
  assets: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      sha256: z.string(),
      bytes: z.number().int().nonnegative(),
      mime: z.string(),
      r2Key: z.string(),
    }),
  ),
  checkRuns: z.array(
    z.object({
      id: z.string(),
      reviewCheckerRevision: z.string(),
      routeGate: z.string(),
      report: jsonValueSchema,
      reportHash: z.string(),
      durationMs: z.number(),
      createdAt: z.string(),
    }),
  ),
  review: z
    .object({
      id: z.string(),
      submissionId: z.string(),
      reviewerId: z.string(),
      decision: z.string(),
      reason: z.string().nullable(),
      manifestHash: z.string().nullable(),
      checkerVersion: z.string().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
});

export type AdminSubmissionDetail = z.infer<typeof adminSubmissionDetailSchema>;

export const adminMemberSchema = z.object({
  id: z.string(),
  username: z.string(),
  globalName: z.string().nullable(),
  avatar: z.string().nullable().optional(),
  role: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const adminMemberListSchema = z.object({
  items: z.array(adminMemberSchema),
  nextCursor: z.string().nullable(),
});

export type AdminMember = z.infer<typeof adminMemberSchema>;
export type AdminMemberList = z.infer<typeof adminMemberListSchema>;

export const adminProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  projectType: z.string().nullable(),
  visibility: z.enum(["public", "private"]),
  author: z.object({ id: z.string(), name: z.string() }),
  publishedRevisionId: z.string().nullable(),
  deletedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export const adminProjectListSchema = z.object({
  items: z.array(adminProjectSchema),
  nextCursor: z.string().nullable(),
});

export type AdminProject = z.infer<typeof adminProjectSchema>;
export type AdminProjectList = z.infer<typeof adminProjectListSchema>;

export const adminAuditEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  detail: jsonValueSchema,
  createdAt: z.string(),
});

export const adminAuditListSchema = z.object({
  items: z.array(adminAuditEventSchema),
  nextCursor: z.string().nullable(),
});

export type AdminAuditEvent = z.infer<typeof adminAuditEventSchema>;
export type AdminAuditList = z.infer<typeof adminAuditListSchema>;

export const siteSettingsSchema = z.object({
  banner: z
    .object({
      imageUrl: z.string().nullable(),
      positionX: z.number(),
      positionY: z.number(),
      zoom: z.number(),
      mobilePositionX: z.number(),
      mobilePositionY: z.number(),
      mobileZoom: z.number(),
    })
    .nullable(),
  siteContent: jsonValueSchema,
});

export type SiteSettings = z.infer<typeof siteSettingsSchema>;
