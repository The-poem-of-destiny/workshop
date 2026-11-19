export const AUDIT_ACTIONS = [
  "member.role_change",
  "member.policy_accept",
  "site.update",
  "project.patch",
  "project.delete",
  "submission.withdraw",
  "submission.cutover_supersede",
  "companion.publish",
  "collection.create",
  "collection.update",
  "collection.delete",
  "recommendation.update",
  "recommendation.delete",
  "legacy.admin_added",
  "legacy.admin_removed",
  "legacy.character_reference_created",
  "legacy.character_reference_version_created",
  "legacy.editor_pick_removed",
  "legacy.editor_pick_saved",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const AUDIT_ACTION_SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

export function isAuditAction(value: string): value is AuditAction {
  return AUDIT_ACTION_SET.has(value);
}
