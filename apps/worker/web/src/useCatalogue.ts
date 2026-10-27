import { useEffect, useRef, useState } from "react";
import { api, type ProjectSummary } from "./api";
import { useCatalogueFilters } from "./useCatalogueFilters";
export function useCatalogue({ setError }: { setError: (message: string | null) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const {
    search,
    sort,
    projectType,
    author,
    tag,
    setTag,
    setSearch,
    setProjectType,
    clearFilters,
    setAuthor,
    setSort,
    layout,
    setLayout,
    hasFilters,
  } = useCatalogueFilters();
  const [pageSize, setPageSize] = useState(25);
  const [paging, setPaging] = useState<{ key: string; cursors: (string | undefined)[]; index: number }>({
    key: "",
    cursors: [undefined],
    index: 0,
  });
  const [listLoading, setListLoading] = useState(true);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [listRetry, setListRetry] = useState(0);
  const listRequest = useRef<{ retry: number } | null>(null);
  const queryKey = JSON.stringify([search.trim(), sort, projectType, author?.id, tag.trim(), pageSize]);
  const pageIndex = paging.key === queryKey ? paging.index : 0;
  const pageCursors = paging.key === queryKey ? paging.cursors : [undefined];
  const pageCursor = pageCursors[pageIndex];
  useEffect(() => {
    let cancelled = false;
    const requestId = { retry: listRetry };
    listRequest.current = requestId;
    setListLoading(true);
    setLoadedQuery("");
    setError(null);
    setPaging((previous) => (previous.key === queryKey ? previous : { key: queryKey, cursors: [undefined], index: 0 }));
    const timer = setTimeout(() => {
      api
        .projects({
          search: search.trim() || undefined,
          sort,
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
  }, [search, sort, projectType, author, tag, pageCursor, pageSize, queryKey, listRetry, setError]);
  function changePage(index: number): void {
    if (listLoading || index < 0) return;
    const cursors = [...pageCursors];
    if (index > pageIndex) {
      if (loadedQuery !== queryKey || !nextCursor) return;
      cursors[index] = nextCursor;
      cursors.length = index + 1;
    }
    setListLoading(true);
    setPaging({ key: queryKey, cursors, index });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const pageTags = [...new Set(projects.flatMap((project) => project.tags))].slice(0, 10);
  return {
    setTag,
    search,
    setSearch,
    projectType,
    tag,
    author,
    setProjectType,
    clearFilters,
    pageTags,
    setAuthor,
    sort,
    setSort,
    layout,
    setLayout,
    hasFilters,
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
