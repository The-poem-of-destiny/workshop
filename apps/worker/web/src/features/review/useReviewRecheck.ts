import type { AdminSubmissionListItem } from "../../api";
import { api } from "../../api";
import type { useReviewQueue } from "./useReviewQueue";

type QueueCheckStatus = AdminSubmissionListItem["checkStatus"];

const knownCheckStatuses: readonly QueueCheckStatus[] = ["queued", "running", "done", "needs_human", "failed"];

/** The detail DTO widens the check status to a string; map it back onto the queue contract. */
function toQueueCheckStatus(value: string): QueueCheckStatus | null {
  return knownCheckStatuses.find((status) => status === value) ?? null;
}
type ReviewRecheckOptions = Pick<
  ReturnType<typeof useReviewQueue>,
  "selectedId" | "setBusy" | "setCounts" | "cache" | "setDetail" | "setItems" | "setPolling"
> & { onError: (message: string) => void; onNotice: (message: string) => void };
export function useReviewRecheck({
  selectedId,
  setBusy,
  setCounts,
  cache,
  setDetail,
  setItems,
  setPolling,
  onError,
  onNotice,
}: ReviewRecheckOptions) {
  async function recheck(): Promise<void> {
    if (!selectedId) return;
    const currentId = selectedId;
    setBusy(true);
    try {
      const result = await api.adminRecheck(currentId);
      setCounts((previous) =>
        previous
          ? { ...previous, pending: Math.max(0, previous.pending - 1), checking: previous.checking + 1 }
          : previous,
      );
      cache.current.delete(currentId);
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
      onError(String(value));
    } finally {
      setBusy(false);
    }
  }
  return recheck;
}
