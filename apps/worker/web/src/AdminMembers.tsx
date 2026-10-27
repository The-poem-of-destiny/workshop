import type { useAdminMembers } from "./useAdminMembers";

type Role = "member" | "reviewer" | "owner";

const ROLE_LABELS: Record<Role, string> = {
  member: "成员",
  reviewer: "审核员",
  owner: "站长",
};

export function AdminMembers({
  visibleMembers,
  memberRoleFilter,
  setMemberRoleFilter,
  memberError,
  requestRoleChange,
  memberCursor,
  memberLoadingMore,
  loadMoreMembers,
}: {
  visibleMembers: ReturnType<typeof useAdminMembers>["visibleMembers"];
  memberRoleFilter: ReturnType<typeof useAdminMembers>["memberRoleFilter"];
  setMemberRoleFilter: ReturnType<typeof useAdminMembers>["setMemberRoleFilter"];
  memberError: ReturnType<typeof useAdminMembers>["memberError"];
  requestRoleChange: ReturnType<typeof useAdminMembers>["requestRoleChange"];
  memberCursor: ReturnType<typeof useAdminMembers>["memberCursor"];
  memberLoadingMore: ReturnType<typeof useAdminMembers>["memberLoadingMore"];
  loadMoreMembers: ReturnType<typeof useAdminMembers>["loadMoreMembers"];
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>成员</h2>
        <span className="hint">{visibleMembers.length} 人</span>
      </div>
      <label>
        角色筛选
        <select value={memberRoleFilter} onChange={(event) => setMemberRoleFilter(event.target.value as "all" | Role)}>
          <option value="all">全部角色</option>
          <option value="member">成员</option>
          <option value="reviewer">审核员</option>
          <option value="owner">站长</option>
        </select>
      </label>
      {memberError ? (
        <p className="panel-error" role="alert">
          {memberError}
        </p>
      ) : null}
      <div className="project-list">
        {visibleMembers.length === 0 ? (
          <p className="hint">没有符合筛选条件的成员。</p>
        ) : (
          visibleMembers.map((member) => (
            <div className="member-row" key={member.id}>
              <span>
                <strong>{member.globalName || member.username}</strong>
                <small>
                  {ROLE_LABELS[member.role as Role] ?? member.role} · {member.id}
                </small>
              </span>
              <select value={member.role} onChange={(event) => requestRoleChange(member, event.target.value as Role)}>
                <option value="member">成员</option>
                <option value="reviewer">审核员</option>
                <option value="owner">站长</option>
              </select>
            </div>
          ))
        )}
      </div>
      {memberCursor ? (
        <button type="button" className="load-more" disabled={memberLoadingMore} onClick={() => void loadMoreMembers()}>
          {memberLoadingMore ? "加载中…" : "加载更多成员"}
        </button>
      ) : null}
    </section>
  );
}
