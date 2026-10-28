import type { useReviewQueue } from "./useReviewQueue";

const checkStatusLabels: Record<string, string> = {
  queued: "排队中",
  running: "检查中",
  done: "已完成",
  needs_human: "需人工确认",
  failed: "失败",
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

export function ReviewQueue({
  selectedId,
  items,
  counts,
  loadingQueue,
  queueError,
  refresh,
  visibleItems,
  select,
  moveSelection,
  prefetch,
  nextCursor,
  loadingMore,
  loadMore,
}: {
  selectedId: ReturnType<typeof useReviewQueue>["selectedId"];
  items: ReturnType<typeof useReviewQueue>["items"];
  counts: ReturnType<typeof useReviewQueue>["counts"];
  loadingQueue: ReturnType<typeof useReviewQueue>["loadingQueue"];
  queueError: ReturnType<typeof useReviewQueue>["queueError"];
  refresh: ReturnType<typeof useReviewQueue>["refresh"];
  visibleItems: ReturnType<typeof useReviewQueue>["visibleItems"];
  select: ReturnType<typeof useReviewQueue>["select"];
  moveSelection: ReturnType<typeof useReviewQueue>["moveSelection"];
  prefetch: ReturnType<typeof useReviewQueue>["prefetch"];
  nextCursor: ReturnType<typeof useReviewQueue>["nextCursor"];
  loadingMore: ReturnType<typeof useReviewQueue>["loadingMore"];
  loadMore: ReturnType<typeof useReviewQueue>["loadMore"];
}) {
  return (
    <aside className="review-queue" aria-label="待审核队列">
      <div className="review-section-heading">
        <div>
          <h3>待审核队列</h3>
          <p>{items.length ? "选择一项查看完整证据" : "当前页没有待处理提交"}</p>
        </div>
        <span className="review-queue-total" data-testid="review-queue-count">
          已加载 {items.length} / 待审 {counts?.pending ?? "…"}
        </span>
      </div>
      {loadingQueue && items.length === 0 ? (
        <p className="review-state" role="status">
          正在加载队列...
        </p>
      ) : queueError && items.length === 0 ? (
        <div className="review-state review-state-error" role="alert">
          <strong>队列加载失败</strong>
          <span>{queueError}</span>
          <button className="review-button review-button-secondary" type="button" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="review-state">暂无待处理提交。</p>
      ) : visibleItems.length === 0 ? (
        <p className="review-state">当前搜索没有匹配项。</p>
      ) : (
        <div className="review-queue-list">
          {visibleItems.map((item) => (
            <button
              className={`review-queue-item${item.id === selectedId ? " is-selected" : ""}`}
              type="button"
              aria-current={item.id === selectedId ? "true" : undefined}
              key={item.id}
              onClick={() => void select(item.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveSelection(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveSelection(-1);
                }
              }}
              onMouseEnter={() => prefetch(item.id)}
              onFocus={() => prefetch(item.id)}
              data-testid="review-queue-item"
            >
              <span className="review-queue-item-main">
                <strong>{item.projectTitle}</strong>
                <span>{item.author.name}</span>
                <small>
                  {formatDate(item.submittedAt)} · {checkStatusLabels[item.checkStatus] ?? item.checkStatus}
                </small>
              </span>
              <span className={`review-gate review-gate-${item.gate ?? "missing"}`}>{item.gate ?? "missing"}</span>
            </button>
          ))}
        </div>
      )}
      {nextCursor ? (
        <button className="review-load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? "加载中..." : "加载更多提交"}
        </button>
      ) : null}
    </aside>
  );
}
