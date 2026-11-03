import { type AuditAction, auditActionSchema } from "@workshop/contracts";
import type { JsonValue } from "./api";

import type { useAdminAudit } from "./useAdminAudit";

const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "project.patch": "编辑项目",
  "project.delete": "删除项目",
  "member.role_change": "修改成员角色",
  "recommendation.update": "更新玩家推荐",
  "recommendation.delete": "撤回玩家推荐",
  "site.update": "更新站点设置",
  "submission.withdraw": "撤回投稿",
  "submission.cutover_supersede": "切换时替代投稿",
  "companion.publish": "发布配套脚本",
  "legacy.admin_added": "历史：添加管理员",
  "legacy.admin_removed": "历史：移除管理员",
  "legacy.character_reference_created": "历史：创建角色参考",
  "legacy.character_reference_version_created": "历史：创建角色参考版本",
  "legacy.editor_pick_removed": "历史：移除编辑精选",
  "legacy.editor_pick_saved": "历史：保存编辑精选",
  "legacy.current_schema_event": "历史：切换前操作",
};

const AUDIT_ACTION_OPTIONS = auditActionSchema.options;

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
  auditError,
}: {
  auditBusy: ReturnType<typeof useAdminAudit>["auditBusy"];
  loadAudit: ReturnType<typeof useAdminAudit>["loadAudit"];
  auditAction: ReturnType<typeof useAdminAudit>["auditAction"];
  changeAuditAction: ReturnType<typeof useAdminAudit>["changeAuditAction"];
  audit: ReturnType<typeof useAdminAudit>["audit"];
  auditCursor: ReturnType<typeof useAdminAudit>["auditCursor"];
  auditLoadingMore: ReturnType<typeof useAdminAudit>["auditLoadingMore"];
  auditError: string | null;
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
      {auditError ? (
        <p className="panel-error" role="alert">
          {auditError}
        </p>
      ) : null}
      <div className="audit-list">
        {audit.length === 0 ? (
          <p className="hint">{auditBusy ? "加载中…" : auditError ? "日志未能加载，请重试。" : "暂无审计事件。"}</p>
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
