import { useMemo, useState } from "react";
import type { AdminSubmissionListItem, AdminSubmissionListResponse } from "../../api";
import { api } from "../../api";
import { useReviewPolling } from "./useReviewPolling";
import { useReviewSelection } from "./useReviewSelection";

type ReviewQueueOptions = { onError: (message: string) => void; onNotice: (message: string) => void };
export function useReviewQueue({ onError, onNotice }: ReviewQueueOptions) {
  const [items, setItems] = useState<AdminSubmissionListItem[]>([]);
  const [polling, setPolling] = useState(false);
  const [counts, setCounts] = useState<AdminSubmissionListResponse["counts"] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      [item.projectTitle, item.author.name, item.id, item.status, item.gate ?? "", item.checkStatus]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [items, query]);
  const selection = useReviewSelection({ items, visibleItems, setPolling, onError });
  const { selectedRef, clearSelection, select, selectedId, setDetail, setDiff, cache } = selection;
  const position = selectedId ? visibleItems.findIndex((item) => item.id === selectedId) + 1 : 0;

  async function refresh(): Promise<void> {
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const result = await api.adminSubmissions("pending");
      setItems(result.items);
      setCounts(result.counts);
      setNextCursor(result.nextCursor);
      if (selectedRef.current && !result.items.some((item) => item.id === selectedRef.current)) clearSelection();
    } catch (value) {
      const message = String(value);
      setQueueError(message);
      onError(message);
    } finally {
      setLoadingQueue(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api.adminSubmissions("pending", nextCursor);
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...result.items.filter((item) => !seen.has(item.id))];
      });
      setCounts(result.counts);
      setNextCursor(result.nextCursor);
    } catch (value) {
      onError(String(value));
    } finally {
      setLoadingMore(false);
    }
  }

  function advance(currentId: string): void {
    const index = visibleItems.findIndex((item) => item.id === currentId);
    const remainingVisible = visibleItems.filter((item) => item.id !== currentId);
    const next =
      remainingVisible.length > 0 ? remainingVisible[Math.min(Math.max(index, 0), remainingVisible.length - 1)] : null;
    const remaining = items.filter((item) => item.id !== currentId);
    setItems(remaining);
    if (next) void select(next.id);
    else clearSelection();
    if (remaining.length < 5 && nextCursor) void loadMore();
  }
  useReviewPolling({
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
  });

  function snooze(): void {
    if (!selectedId) return;
    const current = items.find((item) => item.id === selectedId);
    if (!current) return;
    setItems((previous) => [...previous.filter((item) => item.id !== selectedId), current]);
    onNotice("已把当前提交移到队列末尾，稍后再处理。");
  }

  return {
    ...selection,
    refresh,
    loadingQueue,
    counts,
    query,
    setQuery,
    visibleItems,
    items,
    queueError,
    nextCursor,
    loadingMore,
    loadMore,
    snooze,
    position,
    setCounts,
    advance,
    setItems,
    setPolling,
  };
}
