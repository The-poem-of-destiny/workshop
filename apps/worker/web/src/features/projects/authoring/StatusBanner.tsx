import type { AuthorProject } from "../../../api";
import { CHECK_STATUS_LABELS, formatDateTime, SUBMISSION_STATUS_LABELS } from "./status";

/** Banner for the selected project's latest submission, with the new-version action when the version is locked. */
export function ProjectStatusBanner({
  entry,
  busy,
  onNewRevision,
}: {
  entry: AuthorProject;
  busy: boolean;
  onNewRevision: () => void;
}) {
  const submission = entry.latestSubmission;
  if (!submission) return null;
  const frozen = submission.revisionId === entry.workingRevisionId;
  const underReview = submission.status === "pending" || submission.status === "checking";
  const rejected = submission.status === "rejected";
  if (!frozen && !underReview && !rejected) return null;
  const title = rejected ? "最近一次提交已被退回" : underReview ? "当前版本正在审核" : "当前版本已冻结";
  const detail = rejected
    ? `退回于 ${formatDateTime(submission.reviewedAt ?? submission.resolvedAt)}。新建版本后可以重新上传文件并提交。`
    : underReview
      ? `提交于 ${formatDateTime(submission.submittedAt)} · ${CHECK_STATUS_LABELS[submission.checkStatus]}` +
        (submission.checkError ? ` · ${submission.checkError}` : "")
      : submission.status === "approved"
        ? "这个版本已通过并冻结，继续修改请新建版本。"
        : submission.withdrawnAt
          ? `已于 ${formatDateTime(submission.withdrawnAt)} 撤回；继续修改请新建版本。`
          : `最近提交：${SUBMISSION_STATUS_LABELS[submission.status]}。`;
  return (
    <div
      className={`workspace-banner${rejected ? " is-danger" : underReview ? " is-warning" : " is-info"}`}
      role="status"
    >
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        {rejected && submission.reason ? <p className="banner-reason">退回原因：{submission.reason}</p> : null}
      </div>
      {frozen ? (
        <button type="button" onClick={onNewRevision} disabled={busy}>
          新建版本
        </button>
      ) : null}
    </div>
  );
}
