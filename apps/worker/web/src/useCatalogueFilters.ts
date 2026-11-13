import { MAX_SELECTED_TAGS, PROJECT_TYPES, type ProjectType } from "@workshop/domain";
import { type Dispatch, type SetStateAction, useEffect, useReducer, useState } from "react";

export const SORTS = [
  ["updated", "最近更新"],
  ["published", "发布时间"],
  ["downloads", "下载"],
  ["likes", "点赞"],
] as const;

type TaxonomyFilters = {
  projectTypes: ProjectType[];
  includeContained: boolean;
  tags: string[];
  tagLimitMessage: string | null;
};

export type CatalogueSort = (typeof SORTS)[number][0];

export interface CatalogueFilters extends TaxonomyFilters {
  search: string;
  sort: CatalogueSort;
  author: { id: string; name: string } | null;
  layout: "cards" | "list";
  hasFilters: boolean;
  setProjectTypes: (values: readonly ProjectType[]) => void;
  setIncludeContained: (value: boolean) => void;
  addTags: (values: readonly string[]) => void;
  toggleTag: (value: string) => void;
  removeTag: (value: string) => void;
  setSearch: Dispatch<SetStateAction<string>>;
  setAuthor: Dispatch<SetStateAction<{ id: string; name: string } | null>>;
  setSort: Dispatch<SetStateAction<CatalogueSort>>;
  setLayout: Dispatch<SetStateAction<"cards" | "list">>;
  clearFilters: () => void;
}

type TaxonomyAction =
  | { type: "primary"; values: readonly ProjectType[] }
  | { type: "contained"; value: boolean }
  | { type: "addTags"; values: readonly string[] }
  | { type: "toggleTag"; value: string }
  | { type: "removeTag"; value: string }
  | { type: "clear" };

const emptyTaxonomy: TaxonomyFilters = {
  projectTypes: [],
  includeContained: false,
  tags: [],
  tagLimitMessage: null,
};

function taxonomyFilters(state: TaxonomyFilters, action: TaxonomyAction): TaxonomyFilters {
  if (action.type === "clear") return emptyTaxonomy;
  if (action.type === "primary") {
    return { ...state, projectTypes: PROJECT_TYPES.filter((type) => action.values.includes(type)) };
  }
  if (action.type === "contained") return { ...state, includeContained: action.value };
  if (action.type === "removeTag" || (action.type === "toggleTag" && state.tags.includes(action.value.trim()))) {
    return { ...state, tags: state.tags.filter((tag) => tag !== action.value.trim()), tagLimitMessage: null };
  }
  const values = action.type === "addTags" ? action.values : [action.value];
  const additions = [...new Set(values.map((tag) => tag.trim()).filter((tag) => tag && !state.tags.includes(tag)))];
  const room = MAX_SELECTED_TAGS - state.tags.length;
  return {
    ...state,
    tags: room > 0 && additions.length > 0 ? [...state.tags, ...additions.slice(0, room)] : state.tags,
    tagLimitMessage:
      additions.length > room ? `最多可同时筛选 ${MAX_SELECTED_TAGS} 个标签，请先移除已选标签。` : null,
  };
}

export function useCatalogueFilters(): CatalogueFilters {
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
  const [taxonomy, dispatch] = useReducer(taxonomyFilters, emptyTaxonomy);
  const [author, setAuthor] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("published");
  function clearFilters(): void {
    setSearch("");
    dispatch({ type: "clear" });
    setAuthor(null);
  }
  const hasFilters = Boolean(
    search.trim() || taxonomy.projectTypes.length || taxonomy.includeContained || author || taxonomy.tags.length,
  );
  return {
    search,
    sort,
    ...taxonomy,
    setProjectTypes: (values: readonly ProjectType[]) => dispatch({ type: "primary", values }),
    setIncludeContained: (value: boolean) => dispatch({ type: "contained", value }),
    addTags: (values: readonly string[]) => dispatch({ type: "addTags", values }),
    toggleTag: (value: string) => dispatch({ type: "toggleTag", value }),
    removeTag: (value: string) => dispatch({ type: "removeTag", value }),
    author,
    setSearch,
    clearFilters,
    setAuthor,
    setSort,
    layout,
    setLayout,
    hasFilters,
  };
}
