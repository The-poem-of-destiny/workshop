import { adminAuditEventSchema, auditActionSchema, serializeAuditDetail } from "@workshop/contracts";
import { describe, expect, it } from "vitest";

const identity = {
  id: "event",
  targetType: "user",
  targetId: "member",
  actorId: "owner",
  actorName: "Owner",
  createdAt: "2026-10-21T00:00:00.000Z",
};

describe("audit evidence boundary", () => {
  it("rejects unknown actions and details belonging to a different action", () => {
    expect(auditActionSchema.safeParse("legacy.project_approved").success).toBe(false);
    expect(
      adminAuditEventSchema.safeParse({ ...identity, action: "member.role_change", detail: { soft: true } }).success,
    ).toBe(false);
    expect(
      adminAuditEventSchema.safeParse({
        ...identity,
        action: "member.role_change",
        detail: { from: "member", to: "admin" },
      }).success,
    ).toBe(false);
    expect(serializeAuditDetail("member.role_change", { from: "member", to: "reviewer" })).toBe(
      '{"from":"member","to":"reviewer"}',
    );
  });

  it("retains compatibility edit provenance without reviving a compatibility field", () => {
    const detail = {
      sourceTable: "project_metadata_audit_logs",
      legacyActorId: "deleted-member",
      legacyActorName: "Historical name",
      legacyTargetId: "legacy-project",
      beforeValue: '{"compatibility":"4.2"}',
      afterValue: '{"compatibility":"4.3"}',
    };
    const event = adminAuditEventSchema.parse({ ...identity, actorId: null, action: "project.patch", detail });
    expect(event.detail).toEqual(detail);
    expect(adminAuditEventSchema.safeParse({ ...identity, action: "legacy.admin_added", detail }).success).toBe(false);
  });

  it("preserves the original publication-baseline cutover reason", () => {
    const detail = { reason: "publication_baseline_unavailable" };
    expect(adminAuditEventSchema.parse({ ...identity, action: "submission.cutover_supersede", detail }).detail).toEqual(
      detail,
    );
  });
});
