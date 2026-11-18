import type { AuthorProject } from "../../../api";
import { CHECK_STATUS_LABELS, formatDateTime, SUBMISSION_STATUS_LABELS } from "./status";

/** Banner for the selected project's latest submission, with withdraw & new-version actions when locked. */
export function ProjectStatusBanner({
  entry,
  busy,
  onNewVersion,
  onWithdrawAndEdit,
  onWithdrawOnly,
}: {
  entry: AuthorProject;
  busy: boolean;
  onNewVersion: () => void;
  onWithdrawAndEdit?: () => void;
  onWithdrawOnly?: () => void;
}) {
  const submission = entry.latestSubmission;
  const publishedWorking = Boolean(
    entry.workingVersionId && entry.project.publishedVersionId === entry.workingVersionId,
  );
  if (!submission) {
    if (!publishedWorking) return null;
    return (
      <div className="workspace-banner is-info" role="status">
        <div>
          <strong>当前版本已发布并冻结</strong>
          <p>继续修改请新建版本，线上已发布内容保持不变。</p>
        </div>
        <button type="button" onClick={onNewVersion} disabled={busy}>
          新建版本
        </button>
      </div>
    );
  }
  const frozen = publishedWorking || submission.versionId === entry.workingVersionId;
  const underReview = submission.status === "pending" || submission.status === "checking";
  const rejected = submission.status === "rejected";
  if (!frozen && !underReview && !rejected) return null;
  const title = rejected ? "最近一次提交已被退回" : underReview ? "当前版本正在审核" : "当前版本已冻结";
  const detail = rejected
    ? `退回于 ${formatDateTime(submission.reviewedAt ?? submission.resolvedAt)}。新建版本后可以重新上传文件并提交。`
    : underReview
      ? `提交于 ${formatDateTime(submission.submittedAt)} · ${CHECK_STATUS_LABELS[submission.checkStatus]}` +
        (submission.checkError ? ` · ${submission.checkError}` : "") +
        "。若发现有遗漏，可直接撤回审核并继续编辑，线上公开版本不受影响。"
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
      <div className="workspace-banner-actions">
        {underReview && onWithdrawAndEdit ? (
          <button type="button" className="workspace-primary" onClick={onWithdrawAndEdit} disabled={busy}>
            撤回审核并继续修改
          </button>
        ) : null}
        {underReview && onWithdrawOnly ? (
          <button type="button" onClick={onWithdrawOnly} disabled={busy}>
            仅撤回审核
          </button>
        ) : null}
        {frozen && !underReview ? (
          <button type="button" onClick={onNewVersion} disabled={busy}>
            新建版本
          </button>
        ) : null}
      </div>
    </div>
  );
}
