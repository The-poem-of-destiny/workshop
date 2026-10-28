import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { AdminSubmissionDetail, AdminSubmissionListItem, SubmissionDiff } from "../../api";
import { getSessionGeneration, subscribeSessionChange } from "../../api";
import { useReviewDetailCache } from "./useReviewDetailCache";

type ReviewSelectionOptions = {
  items: AdminSubmissionListItem[];
  visibleItems: AdminSubmissionListItem[];
  setPolling: (value: boolean) => void;
  onError: (message: string) => void;
};
export function useReviewSelection({ items, visibleItems, setPolling, onError }: ReviewSelectionOptions) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminSubmissionDetail | null>(null);
  const [diff, setDiff] = useState<SubmissionDiff | null>(null);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const taskScroll = useRef<HTMLDivElement | null>(null);
  const { cache, inflight, loadDetail, invalidateDetail } = useReviewDetailCache();

  function nextId(id: string): string | null {
    const index = items.findIndex((item) => item.id === id);
    return index >= 0 ? (items[index + 1]?.id ?? null) : null;
  }

  function prefetch(id: string | null): void {
    if (!id || cache.current.has(id) || inflight.current.has(id)) return;
    void loadDetail(id).catch(() => undefined);
  }

  function clearSelection(): void {
    selectedRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setDiff(null);
    setDetailError(null);
    setLoadingDetail(false);
    setPolling(false);
    setDecision(null);
    setReason("");
  }
  const clearSessionSelection = useEffectEvent(() => clearSelection());
  useEffect(() => subscribeSessionChange(() => clearSessionSelection()), []);
  async function select(id: string): Promise<void> {
    const sessionGeneration = getSessionGeneration();
    if (selectedRef.current === null)
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    taskScroll.current?.scrollTo({ top: 0 });
    if (selectedRef.current !== id) setPolling(false);
    selectedRef.current = id;
    setSelectedId(id);
    setDetailError(null);
    setReason("");
    setDecision(null);
    const cached = cache.current.get(id);
    if (cached) {
      setDetail(cached.detail);
      setDiff(cached.diff);
      setLoadingDetail(false);
      setPolling(
        cached.detail.submission.checkStatus === "queued" || cached.detail.submission.checkStatus === "running",
      );
      prefetch(nextId(id));
      return;
    }
    setLoadingDetail(true);
    setDetail(null);
    setDiff(null);
    try {
      const value = await loadDetail(id);
      if (selectedRef.current !== id || sessionGeneration !== getSessionGeneration()) return;
      setDetail(value.detail);
      setDiff(value.diff);
      setPolling(value.detail.submission.checkStatus === "queued" || value.detail.submission.checkStatus === "running");
      prefetch(nextId(id));
    } catch (value) {
      if (selectedRef.current !== id || sessionGeneration !== getSessionGeneration()) return;
      const message = String(value);
      setDetailError(message);
      onError(message);
    } finally {
      if (selectedRef.current === id && sessionGeneration === getSessionGeneration()) setLoadingDetail(false);
    }
  }
  async function reloadSelection(id: string): Promise<AdminSubmissionDetail | null> {
    const sessionGeneration = getSessionGeneration();
    invalidateDetail(id);
    try {
      const value = await loadDetail(id);
      if (sessionGeneration !== getSessionGeneration()) return null;
      if (selectedRef.current !== id) return value.detail;
      setDetail(value.detail);
      setDiff(value.diff);
      return value.detail;
    } catch (value) {
      if (sessionGeneration !== getSessionGeneration()) return null;
      onError(String(value));
      return null;
    }
  }
  function moveSelection(direction: -1 | 1): void {
    if (!visibleItems.length) return;
    const index = selectedId ? visibleItems.findIndex((item) => item.id === selectedId) : -1;
    const next = visibleItems[Math.min(Math.max(index + direction, 0), visibleItems.length - 1)];
    if (next) void select(next.id);
  }
  return {
    selectedRef,
    returnFocus,
    taskScroll,
    clearSelection,
    select,
    setReason,
    setDecision,
    cache,
    invalidateDetail,
    setDetail,
    detail,
    setDiff,
    diff,
    prefetch,
    selectedId,
    reloadSelection,
    inflight,
    moveSelection,
    loadingDetail,
    detailError,
    busy,
    decision,
    reason,
    setBusy,
  };
}
