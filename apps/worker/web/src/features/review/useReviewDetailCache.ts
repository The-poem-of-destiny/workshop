import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AdminSubmissionDetail, SubmissionDiff } from "../../api";
import { api, getSessionGeneration, subscribeSessionChange } from "../../api";

export function useReviewDetailCache() {
  const sessionGeneration = useSyncExternalStore(subscribeSessionChange, getSessionGeneration);
  const cache = useRef(new Map<string, { detail: AdminSubmissionDetail; diff: SubmissionDiff }>());
  const inflight = useRef(new Map<string, Promise<{ detail: AdminSubmissionDetail; diff: SubmissionDiff }>>());
  const generation = useRef(sessionGeneration);
  function clearCache() {
    cache.current.clear();
    inflight.current.clear();
    generation.current = getSessionGeneration();
  }
  if (generation.current !== sessionGeneration) clearCache();
  useEffect(
    () =>
      subscribeSessionChange(() => {
        cache.current.clear();
        inflight.current.clear();
        generation.current = getSessionGeneration();
      }),
    [],
  );

  function invalidateDetail(id: string): void {
    cache.current.delete(id);
    inflight.current.delete(id);
  }
  async function loadDetail(id: string): Promise<{ detail: AdminSubmissionDetail; diff: SubmissionDiff }> {
    if (generation.current !== getSessionGeneration()) clearCache();
    const startedGeneration = getSessionGeneration();
    const cached = cache.current.get(id);
    if (cached) return cached;
    const pending = inflight.current.get(id);
    if (pending) return pending;
    const request = Promise.all([api.adminSubmission(id), api.adminDiff(id)])
      .then(([nextDetail, nextDiff]) => {
        if (startedGeneration !== getSessionGeneration() || inflight.current.get(id) !== request) {
          throw new Error("审核会话或任务已变化，请重新加载。");
        }
        const value = { detail: nextDetail, diff: nextDiff };
        cache.current.set(id, value);
        return value;
      })
      .finally(() => {
        if (inflight.current.get(id) === request) inflight.current.delete(id);
      });
    inflight.current.set(id, request);
    return request;
  }
  return { cache, inflight, loadDetail, invalidateDetail, sessionGeneration };
}
