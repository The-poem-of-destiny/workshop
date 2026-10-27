import { ConfirmDialog } from "./components/ui/confirm-dialog";
import type { useAdminMembers } from "./useAdminMembers";

import type { useAdminRecommendations } from "./useAdminRecommendations";

type Role = "member" | "reviewer" | "owner";

const ROLE_LABELS: Record<Role, string> = {
  member: "成员",
  reviewer: "审核员",
  owner: "站长",
};

export function AdminConfirmations({
  pendingRole,
  roleBusy,
  confirmRoleChange,
  setPendingRole,
  removeTarget,
  recBusy,
  confirmRemoveRecommendation,
  setRemoveTarget,
}: {
  pendingRole: ReturnType<typeof useAdminMembers>["pendingRole"];
  roleBusy: ReturnType<typeof useAdminMembers>["roleBusy"];
  confirmRoleChange: ReturnType<typeof useAdminMembers>["confirmRoleChange"];
  setPendingRole: ReturnType<typeof useAdminMembers>["setPendingRole"];
  removeTarget: ReturnType<typeof useAdminRecommendations>["removeTarget"];
  recBusy: ReturnType<typeof useAdminRecommendations>["recBusy"];
  confirmRemoveRecommendation: ReturnType<typeof useAdminRecommendations>["confirmRemoveRecommendation"];
  setRemoveTarget: ReturnType<typeof useAdminRecommendations>["setRemoveTarget"];
}) {
  return (
    <>
      <ConfirmDialog
        open={pendingRole !== null}
        title="确认修改成员角色"
        description={
          pendingRole
            ? `将把 ${pendingRole.member.globalName || pendingRole.member.username} 的角色从「${
                ROLE_LABELS[pendingRole.member.role as Role] ?? pendingRole.member.role
              }」改为「${ROLE_LABELS[pendingRole.role]}」。该成员的所有会话将被撤销，需要重新登录。`
            : undefined
        }
        confirmLabel="确认修改"
        busy={roleBusy}
        onConfirm={() => void confirmRoleChange()}
        onCancel={() => setPendingRole(null)}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title="移除编辑精选"
        description={
          removeTarget ? `将把《${removeTarget.project.title}》从编辑精选中移除，站点首页不再展示这条推荐。` : undefined
        }
        confirmLabel="移除"
        danger
        busy={recBusy}
        onConfirm={() => void confirmRemoveRecommendation()}
        onCancel={() => setRemoveTarget(null)}
      />
    </>
  );
}
