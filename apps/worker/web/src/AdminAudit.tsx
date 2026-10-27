import type { JsonValue } from "./api";

import type { useAdminAudit } from "./useAdminAudit";

/** Chinese labels for the action strings written by apps/worker/src (audit_events inserts). */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "checker.recheck": "重新校验",
  "review.approve": "审核通过",
  "review.reject": "审核拒绝",
  "review.auto_publish": "自动发布",
  "review.auto_publish_conflict": "自动发布冲突",
  "project.patch": "编辑项目",
  "project.delete": "删除项目",
  "project.published_metadata.patch": "编辑已发布信息",
  "project.published_cover.put": "更新已发布封面",
  "member.role_change": "修改成员角色",
  "recommendation.update": "更新编辑精选",
  "recommendation.delete": "移除编辑精选",
  "reference_set.create": "创建角色基线",
  "reference_set.update": "更新角色基线",
  "reference_version.create": "新建基线版本",
  "site.update": "更新站点设置",
};

const AUDIT_ACTION_OPTIONS = Object.keys(AUDIT_ACTION_LABELS);

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function auditReason(detail: JsonValue): string | null {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return null;
  const reason = (detail as Record<string, JsonValue>).reason;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

export function AdminAudit({
  auditBusy,
  loadAudit,
  auditAction,
  changeAuditAction,
  audit,
  auditCursor,
  auditLoadingMore,
}: {
  auditBusy: ReturnType<typeof useAdminAudit>["auditBusy"];
  loadAudit: ReturnType<typeof useAdminAudit>["loadAudit"];
  auditAction: ReturnType<typeof useAdminAudit>["auditAction"];
  changeAuditAction: ReturnType<typeof useAdminAudit>["changeAuditAction"];
  audit: ReturnType<typeof useAdminAudit>["audit"];
  auditCursor: ReturnType<typeof useAdminAudit>["auditCursor"];
  auditLoadingMore: ReturnType<typeof useAdminAudit>["auditLoadingMore"];
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>审计日志</h2>
        <button type="button" disabled={auditBusy} onClick={() => void loadAudit(auditAction)}>
          刷新
        </button>
      </div>
      <label>
        操作类型
        <select value={auditAction} onChange={(event) => changeAuditAction(event.target.value)}>
          <option value="">全部操作</option>
          {AUDIT_ACTION_OPTIONS.map((action) => (
            <option key={action} value={action}>
              {AUDIT_ACTION_LABELS[action]}
            </option>
          ))}
        </select>
      </label>
      <div className="audit-list">
        {audit.length === 0 ? (
          <p className="hint">{auditBusy ? "加载中…" : "暂无审计事件。"}</p>
        ) : (
          audit.map((event) => {
            const reason = auditReason(event.detail);
            return (
              <article className="audit-event" key={event.id}>
                <div className="audit-event-heading">
                  <strong title={event.action}>{AUDIT_ACTION_LABELS[event.action] ?? event.action}</strong>
                  <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                </div>
                <small>
                  {event.actorName ?? event.actorId ?? "系统"} · {event.targetType}
                  {event.targetId ? ` · ${event.targetId}` : ""}
                </small>
                {reason ? <p className="audit-reason">原因：{reason}</p> : null}
                <details>
                  <summary>原始数据</summary>
                  <pre>{JSON.stringify(event.detail, null, 2)}</pre>
                </details>
              </article>
            );
          })
        )}
      </div>
      {auditCursor ? (
        <button
          type="button"
          className="load-more"
          disabled={auditLoadingMore}
          onClick={() => void loadAudit(auditAction, auditCursor)}
        >
          {auditLoadingMore ? "加载中…" : "加载更多审计"}
        </button>
      ) : null}
    </section>
  );
}
