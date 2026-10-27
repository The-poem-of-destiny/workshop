import { useRef, useState } from "react";
import { type AdminMember, ApiError, api } from "./api";

type Role = "member" | "reviewer" | "owner";

const ROLE_LABELS: Record<Role, string> = {
  member: "成员",
  reviewer: "审核员",
  owner: "站长",
};

function roleErrorMessage(value: unknown): string {
  if (value instanceof ApiError) {
    if (value.status === 409 && /last owner/i.test(value.message)) {
      return "无法降级最后一位站长：站点必须至少保留一名站长（owner）。";
    }
    if (value.status === 403) return "只有站长可以修改成员角色。";
    return value.message;
  }
  return String(value);
}
type AdminMembersOptions = { onError: (message: string) => void; onNotice: (message: string) => void };
export function useAdminMembers({ onError, onNotice }: AdminMembersOptions) {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [memberCursor, setMemberCursor] = useState<string | null>(null);
  const [memberLoadingMore, setMemberLoadingMore] = useState(false);
  const [memberRoleFilter, setMemberRoleFilter] = useState<"all" | Role>("all");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<{ member: AdminMember; role: Role } | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const memberLoadingRef = useRef(false);
  const roleBusyRef = useRef(false);
  async function loadMoreMembers(): Promise<void> {
    if (!memberCursor || memberLoadingRef.current) return;
    memberLoadingRef.current = true;
    setMemberLoadingMore(true);
    try {
      const result = await api.adminMembers(memberCursor);
      setMembers((previous) => [...previous, ...result.items]);
      setMemberCursor(result.nextCursor);
    } catch (value) {
      onError(`成员加载失败：${String(value)}`);
    } finally {
      memberLoadingRef.current = false;
      setMemberLoadingMore(false);
    }
  }
  function requestRoleChange(member: AdminMember, role: Role): void {
    if (role === member.role) return;
    setMemberError(null);
    setPendingRole({ member, role });
  }

  async function confirmRoleChange(): Promise<void> {
    if (!pendingRole || roleBusyRef.current) return;
    const { member, role } = pendingRole;
    roleBusyRef.current = true;
    setRoleBusy(true);
    try {
      await api.adminSetRole(member.id, role);
      setMembers((previous) => previous.map((item) => (item.id === member.id ? { ...item, role } : item)));
      setMemberError(null);
      setPendingRole(null);
      onNotice(`已将 ${member.globalName || member.username} 的角色改为${ROLE_LABELS[role]}。`);
    } catch (value) {
      setMemberError(roleErrorMessage(value));
      setPendingRole(null);
    } finally {
      roleBusyRef.current = false;
      setRoleBusy(false);
    }
  }
  const visibleMembers =
    memberRoleFilter === "all" ? members : members.filter((member) => member.role === memberRoleFilter);
  return {
    visibleMembers,
    memberRoleFilter,
    setMemberRoleFilter,
    memberError,
    requestRoleChange,
    memberCursor,
    memberLoadingMore,
    loadMoreMembers,
    pendingRole,
    roleBusy,
    confirmRoleChange,
    setPendingRole,
    setMembers,
    setMemberCursor,
    setMemberError,
  };
}
