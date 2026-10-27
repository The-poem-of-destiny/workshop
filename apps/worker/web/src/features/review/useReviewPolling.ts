import type { Dispatch, SetStateAction } from "react";
import { useEffect, useEffectEvent } from "react";
import type { AdminSubmissionListItem, AdminSubmissionListResponse } from "../../api";
import { api } from "../../api";
import type { useReviewSelection } from "./useReviewSelection";

type QueueCheckStatus = AdminSubmissionListItem["checkStatus"];

const knownCheckStatuses: readonly QueueCheckStatus[] = ["queued", "running", "done", "needs_human", "failed"];

/** The detail DTO widens the check status to a string; map it back onto the queue contract. */
function toQueueCheckStatus(value: string): QueueCheckStatus | null {
  return knownCheckStatuses.find((status) => status === value) ?? null;
}
type ReviewPollingOptions = Pick<
  ReturnType<typeof useReviewSelection>,
  "selectedId" | "selectedRef" | "setDetail" | "setDiff" | "cache"
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
  cache,
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
  const invalidateDetail = useEffectEvent((id: string) => cache.current.delete(id));
  useEffect(() => {
    refreshFromEffect();
  }, []);

  // Polls the open submission while its check is queued/running; never advances the queue.
  useEffect(() => {
    if (!polling || !selectedId) return;
    const id = selectedId;
    let cancelled = false;
    let timer: number | undefined;
    const startedAt = Date.now();
    const settle = (message: string, nextStatus?: QueueCheckStatus) => {
      if (cancelled) return;
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
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > 120_000) {
        settle("检查仍未结束，请稍后手动刷新。");
        return;
      }
      try {
        const next = await api.adminSubmission(id);
        if (cancelled || !isSelected(id)) return;
        setDetail(next);
        invalidateDetail(id);
        setItems((previous) =>
          previous.map((item) =>
            item.id === id
              ? { ...item, checkStatus: toQueueCheckStatus(next.submission.checkStatus) ?? item.checkStatus }
              : item,
          ),
        );
        if (next.submission.checkStatus !== "queued" && next.submission.checkStatus !== "running") {
          try {
            const nextDiff = await api.adminDiff(id);
            if (cancelled || !isSelected(id)) return;
            setDiff(nextDiff);
          } catch {
            // The diff refresh is best-effort; the report is the primary evidence.
          }
          if (next.submission.status !== "pending") {
            setPolling(false);
            reportNotice("这条提交已不在待审队列，报告已刷新。");
            refreshFromEffect();
            return;
          }
          settle("检查已完成，报告已刷新。", toQueueCheckStatus(next.submission.checkStatus) ?? undefined);
          return;
        }
        timer = window.setTimeout(() => void tick(), 4000);
      } catch (value) {
        if (cancelled) return;
        setPolling(false);
        reportError(String(value));
      }
    };
    timer = window.setTimeout(() => void tick(), 4000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [polling, selectedId, setPolling, setItems, setCounts, setDetail, setDiff]);
}
