import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { keyedItems } from "../../../lib/keyedItems";
import type { LocalCheck } from "./checker";

export function ProjectSubmissionReview({
  check,
  busy,
  disabled,
  saveDisabled,
  metadataDirty,
  hasPendingFiles,
  frozen,
  hasWorkingVersion,
  submitNotice,
  confirm,
  onSave,
  onCreateFirstVersion,
  onSubmit,
  onConfirm,
  onCancel,
}: {
  check: LocalCheck | null;
  busy: boolean;
  disabled: boolean;
  saveDisabled: boolean;
  metadataDirty: boolean;
  hasPendingFiles: boolean;
  frozen: boolean;
  hasWorkingVersion: boolean;
  submitNotice: string | null;
  confirm: { kind: "warn" | "block" | "missing" } | null;
  onSave: () => void;
  onCreateFirstVersion: () => void;
  onSubmit: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const statusSummary = frozen
    ? "当前版本已冻结（继续修改请点击上方「新建版本」）"
    : hasPendingFiles
      ? "有已选择但尚未上传的文件，请先在对应区域点击「上传」"
      : metadataDirty
        ? "资料有未保存的修改，请先点击「保存草稿资料」"
        : check
          ? check.gate === "pass"
            ? "草稿已就绪 · 本地预检通过"
            : check.gate === "warn"
              ? `本地预检有 ${check.warnings.length} 条提示`
              : `本地预检发现 ${check.counts.high} 个需处理项`
          : "草稿已保存 · 可直接提交审核";

  return (
    <>
      <footer className="editor-sticky-footer">
        <div className="editor-footer-status" role="status">
          <span
            className={`editor-status-dot${
              frozen ? " is-frozen" : hasPendingFiles || metadataDirty ? " is-dirty" : " is-ready"
            }`}
            aria-hidden="true"
          />
          <div className="editor-footer-copy">
            <span>{statusSummary}</span>
            {submitNotice ? (
              <p className="asset-error" role="alert">
                {submitNotice}
              </p>
            ) : null}
          </div>
        </div>
        <div className="editor-footer-actions">
          {!hasWorkingVersion ? (
            <button type="button" onClick={onCreateFirstVersion} disabled={busy}>
              创建首个版本
            </button>
          ) : null}
          <button
            type="button"
            className={metadataDirty ? "workspace-primary" : undefined}
            onClick={onSave}
            disabled={saveDisabled}
          >
            保存草稿资料
          </button>
          <button type="button" className="primary" onClick={onSubmit} disabled={disabled}>
            提交审核
          </button>
        </div>
      </footer>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "block"
            ? "发现需处理问题，仍提交人工复核？"
            : confirm?.kind === "warn"
              ? "提交前请确认提示项"
              : "确认提交审核"
        }
        description={
          confirm?.kind === "block"
            ? "建议先按检查报告修改后再提交；若确有特殊原因，也可继续提交由审核员人工复核。"
            : confirm?.kind === "warn"
              ? "以下提示不会阻止提交，确认无误后即可送审："
              : "本次未重新选择文件执行本地预检，提交后将由服务器与审核员复核。"
        }
        confirmLabel={confirm?.kind === "warn" ? "确认并提交" : "继续提交"}
        busy={busy}
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        {confirm?.kind === "warn" && check ? (
          check.warnings.length > 0 ? (
            <ul className="confirm-list">
              {keyedItems(check.warnings).map(({ item: finding, key }) => (
                <li key={key}>
                  <strong>
                    [{finding.ruleId}] {finding.title}
                  </strong>
                  {finding.entry ? <span> · {finding.entry}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>请确认已完成自检核对。</p>
          )
        ) : null}
      </ConfirmDialog>
    </>
  );
}
