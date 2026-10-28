import type { AdminSubmissionListItem } from "../../api";
import { api, getSessionGeneration } from "../../api";
import type { useReviewQueue } from "./useReviewQueue";

type QueueCheckStatus = AdminSubmissionListItem["checkStatus"];

const knownCheckStatuses: readonly QueueCheckStatus[] = ["queued", "running", "done", "needs_human", "failed"];

/** The detail DTO widens the check status to a string; map it back onto the queue contract. */
function toQueueCheckStatus(value: string): QueueCheckStatus | null {
  return knownCheckStatuses.find((status) => status === value) ?? null;
}
type ReviewRecheckOptions = Pick<
  ReturnType<typeof useReviewQueue>,
  "selectedId" | "setBusy" | "setCounts" | "invalidateDetail" | "setDetail" | "setDiff" | "setItems" | "setPolling"
> & { onError: (message: string) => void; onNotice: (message: string) => void };
export function useReviewRecheck({
  selectedId,
  setBusy,
  setCounts,
  invalidateDetail,
  setDetail,
  setDiff,
  setItems,
  setPolling,
  onError,
  onNotice,
}: ReviewRecheckOptions) {
  async function recheck(): Promise<void> {
    if (!selectedId) return;
    const currentId = selectedId;
    const sessionGeneration = getSessionGeneration();
    invalidateDetail(currentId);
    setBusy(true);
    try {
      const result = await api.adminRecheck(currentId);
      if (sessionGeneration !== getSessionGeneration()) return;
      setCounts((previous) =>
        previous
          ? { ...previous, pending: Math.max(0, previous.pending - 1), checking: previous.checking + 1 }
          : previous,
      );
      invalidateDetail(currentId);
      setDiff(null);
      const nextStatus: QueueCheckStatus = toQueueCheckStatus(result.status) ?? "queued";
      setDetail((previous) =>
        previous ? { ...previous, submission: { ...previous.submission, checkStatus: nextStatus } } : previous,
      );
      setItems((previous) =>
        previous.map((item) => (item.id === currentId ? { ...item, checkStatus: nextStatus } : item)),
      );
      setPolling(true);
      onNotice("已重新排队检查，完成后会自动刷新当前提交。");
    } catch (value) {
      if (sessionGeneration !== getSessionGeneration()) return;
      onError(String(value));
    } finally {
      setBusy(false);
    }
  }
  return recheck;
}
