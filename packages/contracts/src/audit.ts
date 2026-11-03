import { z } from "zod";

export const auditActionSchema = z.enum([
  "member.role_change",
  "site.update",
  "project.patch",
  "project.delete",
  "submission.withdraw",
  "submission.cutover_supersede",
  "companion.publish",
  "recommendation.update",
  "recommendation.delete",
  "legacy.admin_added",
  "legacy.admin_removed",
  "legacy.character_reference_created",
  "legacy.character_reference_version_created",
  "legacy.editor_pick_removed",
  "legacy.editor_pick_saved",
]);
export type AuditAction = z.infer<typeof auditActionSchema>;

const roleSchema = z.enum(["member", "reviewer", "owner"]);
const base = {
  id: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string().min(1),
};
const recommendationSnapshot = z.object({
  projectVersionId: z.string(),
  comment: z.string(),
});
const legacyIdentity = {
  legacyActorId: z.string(),
  legacyActorName: z.string().nullable(),
  legacyTargetId: z.string().nullable(),
};
const legacyAdminDetail = z.object({
  sourceTable: z.literal("admin_action_logs"),
  ...legacyIdentity,
  legacyDetail: z.string().nullable(),
});
const legacyMetadataDetail = z.object({
  sourceTable: z.enum(["project_metadata_audit_logs", "admin_action_logs"]),
  ...legacyIdentity,
  beforeValue: z.string().nullable(),
  afterValue: z.string().nullable(),
});

export const adminAuditEventSchema = z.discriminatedUnion("action", [
  z.object({
    ...base,
    action: z.literal("member.role_change"),
    detail: z.object({ from: roleSchema, to: roleSchema }),
  }),
  z.object({
    ...base,
    action: z.literal("site.update"),
    detail: z.object({ before: z.record(z.string(), z.json()), after: z.record(z.string(), z.json()) }),
  }),
  z.object({
    ...base,
    action: z.literal("project.patch"),
    detail: z.union([
      z.object({ fields: z.array(z.string()), rowVersion: z.number().int().positive() }),
      legacyMetadataDetail,
    ]),
  }),
  z.object({ ...base, action: z.literal("project.delete"), detail: z.object({ soft: z.literal(true) }) }),
  z.object({ ...base, action: z.literal("submission.withdraw"), detail: z.object({ projectId: z.string() }) }),
  z.object({
    ...base,
    action: z.literal("submission.cutover_supersede"),
    detail: z.object({ reason: z.literal("publication_baseline_unavailable") }),
  }),
  z.object({ ...base, action: z.literal("companion.publish"), detail: z.object({ version: z.string() }) }),
  z.object({
    ...base,
    action: z.literal("recommendation.update"),
    detail: z.object({ before: recommendationSnapshot.nullable(), after: recommendationSnapshot }),
  }),
  z.object({
    ...base,
    action: z.literal("recommendation.delete"),
    detail: z.object({ before: recommendationSnapshot }),
  }),
  z.object({ ...base, action: z.literal("legacy.admin_added"), detail: legacyAdminDetail }),
  z.object({ ...base, action: z.literal("legacy.admin_removed"), detail: legacyAdminDetail }),
  z.object({ ...base, action: z.literal("legacy.character_reference_created"), detail: legacyAdminDetail }),
  z.object({ ...base, action: z.literal("legacy.character_reference_version_created"), detail: legacyAdminDetail }),
  z.object({ ...base, action: z.literal("legacy.editor_pick_removed"), detail: legacyAdminDetail }),
  z.object({ ...base, action: z.literal("legacy.editor_pick_saved"), detail: legacyAdminDetail }),
]);
export const adminAuditListSchema = z.object({
  items: z.array(adminAuditEventSchema),
  nextCursor: z.string().nullable(),
});
export type AdminAuditEvent = z.infer<typeof adminAuditEventSchema>;
export type AdminAuditList = z.infer<typeof adminAuditListSchema>;

export function serializeAuditDetail<A extends AuditAction>(
  action: A,
  detail: Extract<AdminAuditEvent, { action: A }>["detail"],
): string {
  const eventSchema = adminAuditEventSchema.options.find((schema) => schema.shape.action.value === action);
  if (!eventSchema) throw new Error(`Unsupported audit action: ${action}`);
  return JSON.stringify(eventSchema.shape.detail.parse(detail));
}
