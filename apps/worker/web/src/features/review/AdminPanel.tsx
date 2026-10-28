import { ReviewDecisionDialog } from "./ReviewDecisionDialog";
import { ReviewEvidence } from "./ReviewEvidence";
import { ReviewQueue } from "./ReviewQueue";
import { ReviewTaskActions } from "./ReviewTaskActions";
import { ReviewTaskDialog } from "./ReviewTaskDialog";
import { useReviewDecision } from "./useReviewDecision";
import { useReviewEvidence } from "./useReviewEvidence";
import { useReviewQueue } from "./useReviewQueue";
import "./review.css";
export function AdminPanel({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const queue = useReviewQueue({ onError, onNotice });
  const decisionState = useReviewDecision({ ...queue, onError, onNotice });
  const evidence = useReviewEvidence({ ...queue, ...decisionState, onError, onNotice });
  const {
    refresh,
    loadingQueue,
    counts,
    query,
    setQuery,
    visibleItems,
    items,
    selectedId,
    queueError,
    select,
    moveSelection,
    prefetch,
    nextCursor,
    loadingMore,
    loadMore,
    clearSelection,
    loadingDetail,
    detailError,
    detail,
    snooze,
    busy,
    diff,
    position,
    decision,
    setDecision,
    setReason,
    reason,
  } = queue;
  const {
    checking,
    recheck,
    routeGate,
    report,
    latestRun,
    openDecision,
    manualApproval,
    confirmDisabled,
    submitDecision,
    checkFailed,
    blockingFindings,
    trimmedReason,
  } = decisionState;
  const { exporting, exportMarkdown, downloadKind, download } = evidence;
  return (
    <div className="review-workbench" data-testid="review-workbench">
      <header className="review-header">
        <div>
          <p className="review-eyebrow">CONTENT REVIEW</p>
          <h2>审核台</h2>
          <p className="review-subtitle">只显示待审核提交。先确认检查证据，再决定是否发布。</p>
        </div>
        <button
          className="review-button review-button-secondary"
          type="button"
          onClick={() => void refresh()}
          disabled={loadingQueue}
        >
          {loadingQueue ? "刷新中..." : "刷新队列"}
        </button>
      </header>

      <section className="review-counts" aria-label="提交状态计数">
        {counts ? (
          <>
            <span>
              <b>{counts.pending}</b> 待审核
            </span>
            <span>
              <b>{counts.checking}</b> 检查中
            </span>
            <span>
              <b>{counts.approved}</b> 已通过
            </span>
            <span>
              <b>{counts.rejected}</b> 已拒绝
            </span>
          </>
        ) : (
          <span className="review-muted">状态计数加载中...</span>
        )}
      </section>

      <div className="review-search">
        <label htmlFor="review-queue-search">搜索当前队列</label>
        <input
          id="review-queue-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="项目、作者、提交 ID 或 gate"
          autoComplete="off"
        />
        <span className="review-search-count">
          {visibleItems.length}/{items.length}
        </span>
      </div>

      <div className="review-columns">
        <ReviewQueue
          selectedId={selectedId}
          items={items}
          counts={counts}
          loadingQueue={loadingQueue}
          queueError={queueError}
          refresh={refresh}
          visibleItems={visibleItems}
          select={select}
          moveSelection={moveSelection}
          prefetch={prefetch}
          nextCursor={nextCursor}
          loadingMore={loadingMore}
          loadMore={loadMore}
        />
        <ReviewTaskDialog
          selectedId={selectedId}
          detail={detail}
          busy={busy}
          decision={decision}
          clearSelection={clearSelection}
          returnFocus={queue.returnFocus}
          taskScroll={queue.taskScroll}
          footer={
            <ReviewTaskActions
              clearSelection={clearSelection}
              busy={busy}
              checking={checking}
              position={position}
              total={visibleItems.length}
              moveSelection={moveSelection}
              openDecision={openDecision}
              manualApproval={manualApproval}
            />
          }
        >
          <ReviewEvidence
            selectedId={selectedId}
            loadingDetail={loadingDetail}
            detailError={detailError}
            select={select}
            detail={detail}
            checking={checking}
            snooze={snooze}
            busy={busy}
            recheck={recheck}
            exporting={exporting}
            exportMarkdown={exportMarkdown}
            routeGate={routeGate}
            report={report}
            latestRun={latestRun}
            diff={diff}
            downloadKind={downloadKind}
            download={download}
          />
        </ReviewTaskDialog>
      </div>

      <ReviewDecisionDialog
        decision={decision}
        manualApproval={manualApproval}
        busy={busy}
        confirmDisabled={confirmDisabled}
        submitDecision={submitDecision}
        setDecision={setDecision}
        setReason={setReason}
        routeGate={routeGate}
        checkFailed={checkFailed}
        blockingFindings={blockingFindings}
        reason={reason}
        trimmedReason={trimmedReason}
      />
    </div>
  );
}
