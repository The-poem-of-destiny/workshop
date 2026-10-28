import type { ReactNode } from "react";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { keyedItems } from "../../../lib/keyedItems";
import type { LocalCheck } from "./checker";

export function ProjectSubmissionReview({
  check,
  busy,
  disabled,
  submitNotice,
  confirm,
  onSubmit,
  onConfirm,
  onCancel,
  children,
}: {
  check: LocalCheck | null;
  busy: boolean;
  disabled: boolean;
  submitNotice: string | null;
  confirm: { kind: "warn" | "block" | "missing" } | null;
  onSubmit: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="submit-box">
        <strong>提交审核</strong>
        {check ? (
          <span className="status">
            客户端自检（仅覆盖本次选择的文件）：
            {check.gate === "pass"
              ? "通过"
              : check.gate === "warn"
                ? `有 ${check.warnings.length} 条提示，提交前需确认`
                : `${check.counts.high} 个阻断问题，可确认后提交人工审核`}
          </span>
        ) : (
          <span className="status">本次未在本地检查，提交后将进入人工审核；重新选择文件可先检查。</span>
        )}
        <button type="button" className="primary" onClick={onSubmit} disabled={disabled}>
          资料、封面与内容统一送审
        </button>
        {submitNotice ? (
          <p className="asset-error" role="alert">
            {submitNotice}
          </p>
        ) : null}
      </div>
      {children}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "block"
            ? "发现阻断问题，仍提交人工审核？"
            : confirm?.kind === "warn"
              ? "提交前确认提示"
              : "本次未在本地检查"
        }
        description={
          confirm?.kind === "block"
            ? "建议先根据检查报告修改。你也可以保留 block 标记继续提交，此快照将直接进入人工审核，不冒充检查通过。"
            : confirm?.kind === "warn"
              ? "以下提示不会阻止提交，但请确认已经了解这些风险。"
              : "本次未在本地检查，提交后将进入人工审核；重新选择文件可先检查。"
        }
        confirmLabel={confirm?.kind === "warn" ? "确认并提交" : "仍然提交"}
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
            <p>本次检查没有列出具体提示条目，但检查结果仍需要你确认。</p>
          )
        ) : null}
      </ConfirmDialog>
    </>
  );
}
