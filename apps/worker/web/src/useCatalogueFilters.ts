import { useEffect, useState } from "react";
export const SORTS = [
  ["updated", "最近更新"],
  ["published", "发布时间"],
  ["downloads", "下载"],
  ["likes", "点赞"],
] as const;
export function useCatalogueFilters() {
  const [layout, setLayout] = useState<"cards" | "list">(() => {
    try {
      return localStorage.getItem("cw_catalogue_layout") === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("cw_catalogue_layout", layout);
    } catch {
      /* Storage may be unavailable in embeds. */
    }
  }, [layout]);
  const [projectType, setProjectType] = useState("");
  const [author, setAuthor] = useState<{ id: string; name: string } | null>(null);
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("updated");
  function clearFilters(): void {
    setSearch("");
    setProjectType("");
    setTag("");
    setAuthor(null);
  }
  const hasFilters = Boolean(search.trim() || projectType || author || tag.trim());
  return {
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
  };
}
