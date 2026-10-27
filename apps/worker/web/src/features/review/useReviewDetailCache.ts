import { useRef } from "react";
import type { AdminSubmissionDetail, SubmissionDiff } from "../../api";
import { api } from "../../api";
export function useReviewDetailCache() {
  const cache = useRef(new Map<string, { detail: AdminSubmissionDetail; diff: SubmissionDiff }>());
  const inflight = useRef(new Map<string, Promise<{ detail: AdminSubmissionDetail; diff: SubmissionDiff }>>());
  async function loadDetail(id: string): Promise<{ detail: AdminSubmissionDetail; diff: SubmissionDiff }> {
    const cached = cache.current.get(id);
    if (cached) return cached;
    const pending = inflight.current.get(id);
    if (pending) return pending;
    const request = Promise.all([api.adminSubmission(id), api.adminDiff(id)])
      .then(([nextDetail, nextDiff]) => {
        const value = { detail: nextDetail, diff: nextDiff };
        cache.current.set(id, value);
        return value;
      })
      .finally(() => inflight.current.delete(id));
    inflight.current.set(id, request);
    return request;
  }
  return { cache, inflight, loadDetail };
}
