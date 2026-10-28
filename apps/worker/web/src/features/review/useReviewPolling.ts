import type { Dispatch, SetStateAction } from "react";
import { useEffect, useEffectEvent } from "react";
import type { AdminSubmissionDetail, AdminSubmissionListItem, AdminSubmissionListResponse } from "../../api";
import { api, getSessionGeneration } from "../../api";
import type { useReviewSelection } from "./useReviewSelection";

type QueueCheckStatus = AdminSubmissionListItem["checkStatus"];

const knownCheckStatuses: readonly QueueCheckStatus[] = ["queued", "running", "done", "needs_human", "failed"];

/** The detail DTO widens the check status to a string; map it back onto the queue contract. */
function toQueueCheckStatus(value: string): QueueCheckStatus | null {
  return knownCheckStatuses.find((status) => status === value) ?? null;
}
type ReviewPollingOptions = Pick<
  ReturnType<typeof useReviewSelection>,
  "selectedId" | "selectedRef" | "setDetail" | "setDiff" | "invalidateDetail"
> & {
  polling: boolean;
  setPolling: (value: boolean) => void;
  setItems: Dispatch<SetStateAction<AdminSubmissionListItem[]>>;
  setCounts: Dispatch<SetStateAction<AdminSubmissionListResponse["counts"] | null>>;
  refresh: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};
export function useReviewPolling({
  polling,
  selectedId,
  selectedRef,
  setDetail,
  setDiff,
  invalidateDetail,
  setItems,
  setCounts,
  setPolling,
  refresh,
  onError,
  onNotice,
}: ReviewPollingOptions) {
  const refreshFromEffect = useEffectEvent(() => void refresh());
  const reportNotice = useEffectEvent((message: string) => onNotice(message));
  const reportError = useEffectEvent((message: string) => onError(message));
  const isSelected = useEffectEvent((id: string) => selectedRef.current === id);
  const invalidateFromEffect = useEffectEvent((id: string) => invalidateDetail(id));
  useEffect(() => {
    refreshFromEffect();
  }, []);

  // Check the open queued/running submission every 10s while visible, for at most 120s of wall time.
  useEffect(() => {
    if (!polling || !selectedId) return;
    const id = selectedId;
    let cancelled = false;
    let stopped = false;
    const sessionGeneration = getSessionGeneration();
    let inFlight = false;
    let resumePending = false;
    const isCurrent = () => !cancelled && !stopped && sessionGeneration === getSessionGeneration() && isSelected(id);
    let timer: number | undefined;
    const startedAt = Date.now();
    const settle = (message: string, nextStatus?: QueueCheckStatus) => {
      if (cancelled) return;
      stopped = true;
      setPolling(false);
      if (nextStatus) {
        const status = nextStatus;
        setItems((previous) => previous.map((item) => (item.id === id ? { ...item, checkStatus: status } : item)));
        setCounts((previous) =>
          previous
            ? { ...previous, checking: Math.max(0, previous.checking - 1), pending: previous.pending + 1 }
            : previous,
        );
      }
      reportNotice(message);
    };
    const refreshCompletedCheck = async (next: AdminSubmissionDetail) => {
      setDiff(null);
      try {
        const nextDiff = await api.adminDiff(id);
        if (!isCurrent()) return;
        setDiff(nextDiff);
      } catch {
        // The diff refresh is best-effort; the report is the primary evidence.
      }
      if (!isCurrent()) return;
      if (next.submission.status !== "pending") {
        stopped = true;
        setPolling(false);
        reportNotice("这条提交已不在待审队列，报告已刷新。");
        refreshFromEffect();
        return;
      }
      settle("检查已完成，报告已刷新。", toQueueCheckStatus(next.submission.checkStatus) ?? undefined);
    };
    const tick = async () => {
      if (!isCurrent() || document.hidden || inFlight) return;
      if (Date.now() - startedAt > 120_000) {
        settle("检查仍未结束，请稍后手动刷新。");
        return;
      }
      inFlight = true;
      try {
        const next = await api.adminSubmission(id);
        if (!isCurrent() || document.hidden) return;
        setDetail(next);
        invalidateFromEffect(id);
        setItems((previous) =>
          previous.map((item) =>
            item.id === id
              ? { ...item, checkStatus: toQueueCheckStatus(next.submission.checkStatus) ?? item.checkStatus }
              : item,
          ),
        );
        if (next.submission.checkStatus !== "queued" && next.submission.checkStatus !== "running") {
          await refreshCompletedCheck(next);
          return;
        }
        if (!document.hidden) timer = window.setTimeout(() => void tick(), 10_000);
      } catch (value) {
        if (!isCurrent()) return;
        stopped = true;
        setPolling(false);
        reportError(String(value));
      } finally {
        inFlight = false;
        if (resumePending && isCurrent()) {
          resumePending = false;
          if (timer !== undefined) window.clearTimeout(timer);
          void tick();
        }
      }
    };
    const onVisibilityChange = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (document.hidden) {
        resumePending = false;
      } else if (inFlight) {
        resumePending = true;
      } else {
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (!document.hidden) timer = window.setTimeout(() => void tick(), 10_000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [polling, selectedId, setPolling, setItems, setCounts, setDetail, setDiff]);
}
