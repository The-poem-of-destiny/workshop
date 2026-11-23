import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminSubmissionListItem, AdminSubmissionListResponse } from "../../api";
import { api, formatUserError, getSessionGeneration, subscribeSessionChange } from "../../api";
import { useReviewPolling } from "./useReviewPolling";
import { useReviewSelection } from "./useReviewSelection";

function filterQueueItems(items: AdminSubmissionListItem[], query: string): AdminSubmissionListItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter((item) =>
    [item.projectTitle, item.author.name, item.id, item.status, item.gate ?? "", item.checkStatus]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalized),
  );
}

function mergeUniqueQueueItems(
  previous: AdminSubmissionListItem[],
  incoming: AdminSubmissionListItem[],
): AdminSubmissionListItem[] {
  const seen = new Set(previous.map((item) => item.id));
  return [...previous, ...incoming.filter((item) => !seen.has(item.id))];
}

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
  const queueGeneration = useRef(0);
  const loadMoreGeneration = useRef(0);
  const loadingMoreRef = useRef(false);

  const visibleItems = useMemo(() => filterQueueItems(items, query), [items, query]);
  const selection = useReviewSelection({ items, visibleItems, setPolling, onError });
  const { selectedRef, clearSelection, select, selectedId, setDetail, setDiff, invalidateDetail } = selection;
  const position = selectedId ? visibleItems.findIndex((item) => item.id === selectedId) + 1 : 0;
  useEffect(
    () =>
      subscribeSessionChange(() => {
        queueGeneration.current += 1;
        loadMoreGeneration.current += 1;
        loadingMoreRef.current = false;
        setItems([]);
        setCounts(null);
        setNextCursor(null);
        setQueueError(null);
        setLoadingQueue(false);
        setLoadingMore(false);
      }),
    [],
  );

  async function refresh(): Promise<void> {
    const generation = ++queueGeneration.current;
    loadMoreGeneration.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    const sessionGeneration = getSessionGeneration();
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const result = await api.adminSubmissions("pending");
      if (generation !== queueGeneration.current || sessionGeneration !== getSessionGeneration()) return;
      setItems(result.items);
      setCounts(result.counts);
      setNextCursor(result.nextCursor);
      if (selectedRef.current && !result.items.some((item) => item.id === selectedRef.current)) clearSelection();
    } catch (value) {
      if (generation !== queueGeneration.current || sessionGeneration !== getSessionGeneration()) return;
      const message = formatUserError(value);
      setQueueError(message);
      onError(message);
    } finally {
      if (generation === queueGeneration.current && sessionGeneration === getSessionGeneration()) {
        setLoadingQueue(false);
      }
    }
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMoreRef.current) return;
    const generation = ++loadMoreGeneration.current;
    const sessionGeneration = getSessionGeneration();
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const result = await api.adminSubmissions("pending", nextCursor);
      if (generation !== loadMoreGeneration.current || sessionGeneration !== getSessionGeneration()) return;
      setItems((previous) => mergeUniqueQueueItems(previous, result.items));
      setCounts(result.counts);
      setNextCursor(result.nextCursor);
    } catch (value) {
      if (generation !== loadMoreGeneration.current || sessionGeneration !== getSessionGeneration()) return;
      onError(formatUserError(value));
    } finally {
      if (generation === loadMoreGeneration.current) {
        loadingMoreRef.current = false;
        if (sessionGeneration === getSessionGeneration()) setLoadingMore(false);
      }
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
    invalidateDetail,
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
