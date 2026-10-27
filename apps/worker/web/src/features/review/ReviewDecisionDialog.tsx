import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { keyedItems } from "../../lib/keyedItems";

import { bookLabel, gateLabels } from "./check-report";
import type { useReviewDecision } from "./useReviewDecision";
import type { useReviewQueue } from "./useReviewQueue";

export function ReviewDecisionDialog({
  decision,
  manualApproval,
  busy,
  confirmDisabled,
  submitDecision,
  setDecision,
  setReason,
  routeGate,
  checkFailed,
  blockingFindings,
  reason,
  trimmedReason,
}: {
  decision: ReturnType<typeof useReviewQueue>["decision"];
  manualApproval: ReturnType<typeof useReviewDecision>["manualApproval"];
  busy: ReturnType<typeof useReviewQueue>["busy"];
  confirmDisabled: ReturnType<typeof useReviewDecision>["confirmDisabled"];
  submitDecision: ReturnType<typeof useReviewDecision>["submitDecision"];
  setDecision: ReturnType<typeof useReviewQueue>["setDecision"];
  setReason: ReturnType<typeof useReviewQueue>["setReason"];
  routeGate: ReturnType<typeof useReviewDecision>["routeGate"];
  checkFailed: ReturnType<typeof useReviewDecision>["checkFailed"];
  blockingFindings: ReturnType<typeof useReviewDecision>["blockingFindings"];
  reason: ReturnType<typeof useReviewQueue>["reason"];
  trimmedReason: ReturnType<typeof useReviewDecision>["trimmedReason"];
}) {
  return (
    <ConfirmDialog
      open={decision !== null}
      title={decision === "reject" ? "确认拒绝这条提交？" : manualApproval ? "确认人工批准？" : "确认批准这条提交？"}
      description={
        decision === "reject"
          ? "拒绝后提交退回作者，理由会展示给作者。"
          : manualApproval
            ? "服务端门禁为阻断或缺失，或检查未通过。这次批准会记录为人工批准，说明会随审核记录保存。"
            : "批准后提交进入发布流程，决定会记录在案。"
      }
      confirmLabel={decision === "reject" ? "确认拒绝" : manualApproval ? "确认人工批准" : "确认批准"}
      danger={decision === "reject"}
      busy={busy}
      confirmDisabled={confirmDisabled}
      onConfirm={() => void submitDecision()}
      onCancel={() => {
        if (busy) return;
        setDecision(null);
        setReason("");
      }}
    >
      {decision === "approve" && manualApproval ? (
        <div className="review-manual-gate">
          <strong>人工批准依据</strong>
          <p>
            服务端门禁：{gateLabels[routeGate ?? "missing"] ?? routeGate ?? "missing"}
            {checkFailed ? " · 检查失败" : ""}
          </p>
          {blockingFindings.length ? (
            <ul>
              {keyedItems(blockingFindings).map(({ item: finding, key }) => (
                <li key={key}>
                  <code>{finding.ruleId}</code>
                  <span>{finding.title || "阻断项"}</span>
                  <small>
                    {bookLabel(finding.book) || "未标记文件"}
                    {finding.line === null ? "" : `:${finding.line}`}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="review-muted">报告没有列出具体阻断规则，请结合检查报告确认。</p>
          )}
        </div>
      ) : null}
      <label className="review-reason">
        <span>
          {decision === "reject"
            ? "拒绝理由（必填）"
            : manualApproval
              ? "人工批准说明（至少 8 个字符）"
              : "审核说明（可选）"}
        </span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={
            decision === "reject"
              ? "说明拒绝原因，方便作者修改"
              : manualApproval
                ? "说明为什么在阻断/缺少检查情况下仍然批准"
                : "补充审核依据（可选）"
          }
          maxLength={4000}
          rows={4}
        />
        <small>{trimmedReason.length}/4000</small>
      </label>
    </ConfirmDialog>
  );
}
