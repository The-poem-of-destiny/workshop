import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { api, type ProjectSummary } from "./api";
import { type SORTS, useCatalogueFilters } from "./useCatalogueFilters";
import type { HomeLoadState } from "./useWorkshopHome";
export function useCatalogue({
  enabled,
  setError,
  home,
}: {
  enabled: boolean;
  setError: (message: string | null) => void;
  home: HomeLoadState;
}) {
  const [listRetry, setListRetry] = useState(0);
  const [period, setPeriod] = useState<"all" | "7d" | "30d" | "90d">("all");
  const filters = useCatalogueFilters();
  const { search, sort, projectType, author, tag } = filters;
  const effectivePeriod = sort === "downloads" || sort === "likes" ? period : "all";
  const [pageSize, setPageSize] = useState(25);
  const [paging, setPaging] = useState<CataloguePaging>({
    key: "",
    cursors: [undefined],
    index: 0,
  });
  const queryKey = JSON.stringify([
    search.trim(),
    sort,
    effectivePeriod,
    projectType,
    author?.id,
    tag.trim(),
    pageSize,
  ]);
  const pageIndex = paging.key === queryKey ? paging.index : 0;
  const pageCursors = paging.key === queryKey ? paging.cursors : [undefined];
  const pageCursor = pageCursors[pageIndex];
  const defaultQuery =
    !search.trim() &&
    sort === "updated" &&
    effectivePeriod === "all" &&
    !projectType &&
    !author &&
    !tag.trim() &&
    pageSize === 25 &&
    pageIndex === 0 &&
    !pageCursor &&
    listRetry === 0;
  const initialHome = defaultQuery ? home : null;
  const { projects, nextCursor, total, listLoading, setListLoading, loadedQuery } = useCatalogueProjects({
    enabled,
    setError,
    initialHome,
    defaultQuery,
    listRetry,
    queryKey,
    setPaging,
    search,
    sort,
    effectivePeriod,
    projectType,
    author,
    tag,
    pageCursor,
    pageSize,
  });
  function changePage(index: number): void {
    if (listLoading || index < 0 || Math.abs(index - pageIndex) !== 1) return;
    const cursors = [...pageCursors];
    if (index > pageIndex && cursors[index] === undefined) {
      if (loadedQuery !== queryKey || !nextCursor) return;
      cursors[index] = nextCursor;
    }
    setListLoading(true);
    setPaging({ key: queryKey, cursors, index });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const pageTags = [...new Set(projects.flatMap((project) => project.tags))].slice(0, 10);
  return {
    ...filters,
    total,
    period,
    setPeriod,
    pageTags,
    listLoading,
    loadedQuery,
    queryKey,
    projects,
    pageIndex,
    pageSize,
    setListRetry,
    setPageSize,
    changePage,
    nextCursor,
  };
}

type CataloguePaging = { key: string; cursors: (string | undefined)[]; index: number };

function useCatalogueProjects({
  enabled,
  setError,
  initialHome,
  defaultQuery,
  listRetry,
  queryKey,
  setPaging,
  search,
  sort,
  effectivePeriod,
  projectType,
  author,
  tag,
  pageCursor,
  pageSize,
}: {
  enabled: boolean;
  setError: (message: string | null) => void;
  initialHome: HomeLoadState | null;
  defaultQuery: boolean;
  listRetry: number;
  queryKey: string;
  setPaging: Dispatch<SetStateAction<CataloguePaging>>;
  search: string;
  sort: (typeof SORTS)[number][0];
  effectivePeriod: "all" | "7d" | "30d" | "90d";
  projectType: string;
  author: { id: string; name: string } | null;
  tag: string;
  pageCursor: string | undefined;
  pageSize: number;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [loadedQuery, setLoadedQuery] = useState("");
  const listRequest = useRef<{ retry: number } | null>(null);
  const initialHomeAvailable = useRef(true);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const requestId = { retry: listRetry };
    listRequest.current = requestId;
    setListLoading(true);
    setLoadedQuery("");
    setError(null);
    setPaging((previous) => (previous.key === queryKey ? previous : { key: queryKey, cursors: [undefined], index: 0 }));
    if (!defaultQuery) initialHomeAvailable.current = false;
    if (initialHome && initialHomeAvailable.current) {
      if (initialHome.status === "loading")
        return () => {
          cancelled = true;
        };
      initialHomeAvailable.current = false;
      if (initialHome.status === "ready" && initialHome.data.projects.ok) {
        const result = initialHome.data.projects.data;
        setProjects(result.items);
        setNextCursor(result.nextCursor);
        setTotal(result.total);
        setLoadedQuery(queryKey);
      } else {
        setError("项目加载失败，请重新加载。");
      }
      setListLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(() => {
      api
        .projects({
          search: search.trim() || undefined,
          sort,
          period: effectivePeriod,
          projectType: projectType || undefined,
          authorId: author?.id,
          tag: tag.trim() || undefined,
          cursor: pageCursor,
          limit: pageSize,
        })
        .then((result) => {
          if (!cancelled && requestId === listRequest.current) {
            setProjects(result.items);
            setNextCursor(result.nextCursor);
            setTotal(result.total);
            setLoadedQuery(queryKey);
            setListLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled && requestId === listRequest.current) {
            setError("项目加载失败，请重新加载。");
            setListLoading(false);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    enabled,
    search,
    sort,
    effectivePeriod,
    projectType,
    author,
    tag,
    pageCursor,
    pageSize,
    queryKey,
    listRetry,
    initialHome,
    defaultQuery,
    setPaging,
    setError,
  ]);
  return { projects, nextCursor, total, listLoading, setListLoading, loadedQuery };
}
