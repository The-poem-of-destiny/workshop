export function ReviewTaskActions({
  clearSelection,
  busy,
  checking,
  position,
  total,
  moveSelection,
  openDecision,
  manualApproval,
}: {
  clearSelection: () => void;
  busy: boolean;
  checking: boolean;
  position: number;
  total: number;
  moveSelection: (direction: -1 | 1) => void;
  openDecision: (value: "approve" | "reject") => void;
  manualApproval: boolean;
}) {
  return (
    <div className="review-task-footer">
      <button className="review-button review-button-secondary" type="button" disabled={busy} onClick={clearSelection}>
        返回队列
      </button>
      <div className="review-action-bar" data-testid="review-action-bar">
        <button
          className="review-button review-button-secondary"
          type="button"
          disabled={busy || position <= 1}
          onClick={() => moveSelection(-1)}
        >
          上一个
        </button>
        <span className="review-action-position">
          {position > 0 ? position : "–"}/{total}
        </span>
        <button
          className="review-button review-button-secondary"
          type="button"
          disabled={busy || position <= 0 || position >= total}
          onClick={() => moveSelection(1)}
        >
          下一个
        </button>
        <span className="review-action-spacer" />
        <button
          className="review-button review-button-primary"
          type="button"
          disabled={busy || checking}
          title={checking ? "检查完成前不能批准" : "主动重新检查可选"}
          onClick={() => openDecision("approve")}
          data-testid="review-approve"
        >
          {manualApproval ? "人工批准" : "批准"}
        </button>
        <button
          className="review-button review-button-danger"
          type="button"
          disabled={busy}
          onClick={() => openDecision("reject")}
          data-testid="review-reject"
        >
          拒绝
        </button>
      </div>
    </div>
  );
}
