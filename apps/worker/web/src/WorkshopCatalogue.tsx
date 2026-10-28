import { ChevronLeft, ChevronRight, LayoutGrid, List, X } from "lucide-react";
import type { RefObject } from "react";
import type { ProjectSummary } from "./api";
import { Button } from "./components/ui/button";
import { Discovery } from "./features/projects/Discovery";
import { ProjectCard } from "./features/projects/ProjectCard";
import type { useCatalogue } from "./useCatalogue";

import { SORTS } from "./useCatalogueFilters";

export function WorkshopCatalogue({
  hasFilters,
  total,
  period,
  setPeriod,
  search,
  setSearch,
  projectType,
  setProjectType,
  author,
  setAuthor,
  tag,
  setTag,
  clearFilters,
  detailOpener,
  setSelected,
  sort,
  setSort,
  layout,
  setLayout,
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
}: {
  total: number;
  period: "all" | "7d" | "30d" | "90d";
  setPeriod: (period: "all" | "7d" | "30d" | "90d") => void;
  hasFilters: ReturnType<typeof useCatalogue>["hasFilters"];
  search: ReturnType<typeof useCatalogue>["search"];
  setSearch: ReturnType<typeof useCatalogue>["setSearch"];
  projectType: ReturnType<typeof useCatalogue>["projectType"];
  setProjectType: ReturnType<typeof useCatalogue>["setProjectType"];
  author: ReturnType<typeof useCatalogue>["author"];
  setAuthor: ReturnType<typeof useCatalogue>["setAuthor"];
  tag: ReturnType<typeof useCatalogue>["tag"];
  setTag: ReturnType<typeof useCatalogue>["setTag"];
  clearFilters: ReturnType<typeof useCatalogue>["clearFilters"];
  detailOpener: RefObject<HTMLElement | null>;
  setSelected: (project: ProjectSummary | null) => void;
  sort: ReturnType<typeof useCatalogue>["sort"];
  setSort: ReturnType<typeof useCatalogue>["setSort"];
  layout: ReturnType<typeof useCatalogue>["layout"];
  setLayout: ReturnType<typeof useCatalogue>["setLayout"];
  listLoading: ReturnType<typeof useCatalogue>["listLoading"];
  loadedQuery: ReturnType<typeof useCatalogue>["loadedQuery"];
  queryKey: ReturnType<typeof useCatalogue>["queryKey"];
  projects: ReturnType<typeof useCatalogue>["projects"];
  pageIndex: ReturnType<typeof useCatalogue>["pageIndex"];
  pageSize: ReturnType<typeof useCatalogue>["pageSize"];
  setListRetry: ReturnType<typeof useCatalogue>["setListRetry"];
  setPageSize: ReturnType<typeof useCatalogue>["setPageSize"];
  changePage: ReturnType<typeof useCatalogue>["changePage"];
  nextCursor: ReturnType<typeof useCatalogue>["nextCursor"];
}) {
  return (
    <>
      {hasFilters ? (
        <section className="active-filters" aria-label="当前筛选条件">
          <span className="active-filters-label">筛选</span>
          {search.trim() ? (
            <button type="button" className="filter-chip active" onClick={() => setSearch("")} title="移除搜索条件">
              搜索：{search.trim()}
              <X aria-hidden="true" />
            </button>
          ) : null}
          {projectType ? (
            <button
              type="button"
              className="filter-chip active"
              onClick={() => setProjectType("")}
              title="移除类型筛选"
            >
              类型：{projectType}
              <X aria-hidden="true" />
            </button>
          ) : null}
          {author ? (
            <button type="button" className="filter-chip active" onClick={() => setAuthor(null)} title="移除作者筛选">
              作者：{author.name}
              <X aria-hidden="true" />
            </button>
          ) : null}
          {tag.trim() ? (
            <button type="button" className="filter-chip active" onClick={() => setTag("")} title="移除标签筛选">
              标签：{tag.trim()}
              <X aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className="active-filters-clear" onClick={clearFilters}>
            清除全部
          </button>
        </section>
      ) : null}
      {!hasFilters ? (
        <Discovery
          onOpen={(project, opener) => {
            detailOpener.current = opener;
            setSelected(project);
          }}
        />
      ) : null}
      <div className="catalogue-toolbar">
        <nav className="sorts" aria-label="排序">
          {SORTS.map(([value, label]) => (
            <button key={value} type="button" className={sort === value ? "active" : ""} onClick={() => setSort(value)}>
              {label}
            </button>
          ))}
        </nav>
        {sort === "downloads" || sort === "likes" ? (
          <select
            aria-label="统计周期"
            value={period}
            onChange={(event) => setPeriod(event.target.value as typeof period)}
          >
            <option value="all">全部时间</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
            <option value="90d">最近 90 天</option>
          </select>
        ) : null}
        <fieldset className="layout-switch" aria-label="浏览布局">
          {(["cards", "list"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              aria-pressed={layout === mode}
              title={mode === "cards" ? "卡片式" : "列表式"}
              aria-label={mode === "cards" ? "卡片式" : "列表式"}
              onClick={() => setLayout(mode)}
            >
              {mode === "cards" ? <LayoutGrid aria-hidden="true" /> : <List aria-hidden="true" />}
            </button>
          ))}
        </fieldset>
      </div>
      <p className="list-range" tabIndex={-1}>
        {listLoading
          ? "加载中…"
          : loadedQuery !== queryKey
            ? "加载失败"
            : projects.length === 0
              ? `共 ${total} 个项目`
              : `共 ${total} 个项目，当前显示 ${pageIndex * pageSize + 1}–${pageIndex * pageSize + projects.length} · 第 ${pageIndex + 1} 页`}
      </p>
      {!listLoading && loadedQuery !== queryKey ? (
        <button type="button" onClick={() => setListRetry((value) => value + 1)}>
          重新加载
        </button>
      ) : null}
      <div className={`grid catalogue-grid${layout === "list" ? " catalogue-list" : ""}`} aria-busy={listLoading}>
        {(loadedQuery === queryKey ? projects : []).map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            layout={layout}
            onOpen={(item, opener) => {
              detailOpener.current = opener;
              setSelected(item);
            }}
          />
        ))}
      </div>
      {!listLoading && loadedQuery === queryKey && projects.length === 0 ? (
        <div className="catalogue-empty">
          <p className="catalogue-empty-title">{hasFilters ? "没有符合条件的项目" : "暂无项目"}</p>
          <p className="catalogue-empty-hint">
            {hasFilters
              ? "试试减少筛选条件，或清除后重新浏览。"
              : "稍后再来看看，或者从 SillyTavern 内打开工坊安装项目。"}
          </p>
          {hasFilters ? (
            <Button type="button" variant="secondary" onClick={clearFilters}>
              清除筛选
            </Button>
          ) : null}
        </div>
      ) : null}
      <nav className="pagination" aria-label="分页">
        <label>
          每页
          <select
            aria-label="每页项目数"
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
          >
            {[25, 50].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label="上一页"
          title="上一页"
          disabled={listLoading || pageIndex === 0}
          onClick={() => changePage(pageIndex - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <span aria-live="polite">第 {pageIndex + 1} 页</span>
        <button
          type="button"
          aria-label="下一页"
          title="下一页"
          disabled={listLoading || loadedQuery !== queryKey || !nextCursor}
          onClick={() => changePage(pageIndex + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </nav>
    </>
  );
}
