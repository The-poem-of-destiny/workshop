import type { AuthorSubmission } from "../../../api";
import { CHECK_STATUS_LABELS, formatDateTime, GATE_TEXT, SUBMISSION_STATUS_LABELS } from "./status";

/** Read-only timeline of the author's submissions for one project. */
export function SubmissionHistory({ items, error }: { items: readonly AuthorSubmission[]; error: string | null }) {
  return (
    <section className="submission-history">
      <div className="submission-history-heading">
        <h3>提交历史</h3>
        <p className="field-hint">每次提交的检查与审核结果都会保留在这里。</p>
      </div>
      {error ? (
        <p className="asset-error" role="alert">
          无法加载提交历史：{error}
        </p>
      ) : null}
      {!error && items.length === 0 ? <p className="asset-empty">还没有提交记录。</p> : null}
      <ol className="submission-timeline">
        {items.map((item) => (
          <li className={`submission-item is-${item.status}`} key={item.id}>
            <div className="submission-item-heading">
              <strong>{SUBMISSION_STATUS_LABELS[item.status]}</strong>
              <span>提交于 {formatDateTime(item.submittedAt)}</span>
            </div>
            <p className="submission-meta">
              检查：{CHECK_STATUS_LABELS[item.checkStatus]}
              {item.checkedAt ? `（${formatDateTime(item.checkedAt)}）` : ""}
              {item.gate ? ` · 客户端门禁：${GATE_TEXT[item.gate] ?? item.gate}` : ""}
            </p>
            {item.decision ? (
              <p className="submission-meta">
                审核结果：{item.decision === "approve" ? "通过" : "退回"}
                {item.reviewedAt ? `（${formatDateTime(item.reviewedAt)}）` : ""}
              </p>
            ) : null}
            {item.reason ? <p className="submission-reason">原因：{item.reason}</p> : null}
            {item.checkError ? <p className="submission-reason">检查错误：{item.checkError}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
