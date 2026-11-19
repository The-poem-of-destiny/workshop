import { ChevronLeft, ChevronRight, LayoutGrid, List, PanelLeftOpen, SlidersHorizontal, X } from "lucide-react";
import type { RefObject } from "react";
import type { ProjectSummary } from "../../api";
import { Button } from "../../components/ui/button";
import type { DiscordPromptTarget } from "../policy/DiscordLinkPrompt";
import { CollectionAuthorBanner } from "../projects/CollectionAuthorBanner";
import { ProjectCard } from "../projects/ProjectCard";
import type { CatalogueState } from "./useCatalogue";
import { SORTS } from "./useCatalogueFilters";

export function WorkshopCatalogue({
  catalogue,
  isMobile,
  sidebarCollapsed,
  onExpandSidebar,
  onOpenMobileFilters,
  detailOpener,
  setSelected,
  onDiscordPrompt,
}: {
  catalogue: CatalogueState;
  isMobile: boolean;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  onOpenMobileFilters: () => void;
  detailOpener: RefObject<HTMLElement | null>;
  setSelected: (project: ProjectSummary | null) => void;
  onDiscordPrompt?: (target: DiscordPromptTarget) => void;
}) {
  const {
    hasFilters,
    total,
    period,
    setPeriod,
    search,
    setSearch,
    projectTypes,
    setProjectTypes,
    includeContained,
    setIncludeContained,
    author,
    setAuthor,
    collection,
    setCollection,
    tags,
    removeTag,
    tagLimitMessage,
    clearFilters,
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
  } = catalogue;
  return (
    <section className="catalogue-section" aria-label="作品目录">
      <CollectionAuthorBanner
        author={author}
        collection={collection}
        total={total}
        onSelectAuthor={setAuthor}
        onSelectCollection={setCollection}
        onClearScope={() => {
          setAuthor(null);
          setCollection(null);
        }}
      />

      {hasFilters ? (
        <section className="active-filters" aria-label="当前筛选条件">
          <span className="active-filters-label">当前筛选</span>
          {search.trim() ? (
            <button type="button" className="filter-chip active" onClick={() => setSearch("")} title="移除搜索条件">
              搜索：{search.trim()}
              <X aria-hidden="true" />
            </button>
          ) : null}
          {projectTypes.map((type) => (
            <button
              key={type}
              type="button"
              className="filter-chip active"
              onClick={() => setProjectTypes(projectTypes.filter((value) => value !== type))}
              title={`移除主要分类 ${type}`}
            >
              主要分类：{type}
              <X aria-hidden="true" />
            </button>
          ))}
          {includeContained ? (
            <button type="button" className="filter-chip active" onClick={() => setIncludeContained(false)}>
              包含类型也匹配
              <X aria-hidden="true" />
            </button>
          ) : null}
          {collection ? (
            <button
              type="button"
              className="filter-chip active"
              onClick={() => setCollection(null)}
              title="退出合集筛选"
            >
              合集：{collection.title}
              <X aria-hidden="true" />
            </button>
          ) : null}
          {author ? (
            <button type="button" className="filter-chip active" onClick={() => setAuthor(null)} title="移除作者筛选">
              作者：{author.name}
              <X aria-hidden="true" />
            </button>
          ) : null}
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="filter-chip active"
              onClick={() => removeTag(tag)}
              title={`移除标签 ${tag}`}
            >
              标签：{tag}
              <X aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="active-filters-clear" onClick={clearFilters}>
            清除全部
          </button>
        </section>
      ) : null}

      {tagLimitMessage ? (
        <p className="catalogue-filter-message" role="status">
          {tagLimitMessage}
        </p>
      ) : null}

      <div className="catalogue-toolbar">
        <div className="catalogue-toolbar-lead">
          {!isMobile && sidebarCollapsed ? (
            <button type="button" className="sidebar-expand-btn" aria-label="展开筛选栏" onClick={onExpandSidebar}>
              <PanelLeftOpen aria-hidden="true" />
              <span>筛选栏</span>
            </button>
          ) : null}
          <h2 className="catalogue-heading">
            {collection ? "合集内作品" : author ? "该作者的作品" : hasFilters ? "筛选结果" : "全部作品"}
          </h2>
          <p className="list-range" tabIndex={-1}>
            {listLoading ? (
              "加载中…"
            ) : loadedQuery !== queryKey ? (
              "加载失败"
            ) : projects.length === 0 ? (
              `共 ${total} 个项目`
            ) : (
              <>
                共 {total} 个项目
                <span className="list-range-detail">
                  {" "}
                  · 显示 {pageIndex * pageSize + 1}–{pageIndex * pageSize + projects.length}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="catalogue-sort-group">
          <nav className="sorts" aria-label="排序">
            {SORTS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={sort === value ? "active" : ""}
                onClick={() => setSort(value)}
              >
                {label}
              </button>
            ))}
          </nav>
          {sort === "downloads" || sort === "likes" ? (
            <select
              className="period-select"
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
        </div>
        <div className="catalogue-view-actions">
          {isMobile ? (
            <button
              type="button"
              className={`mobile-filter-btn${hasFilters ? " is-active" : ""}`}
              aria-label="筛选条件"
              onClick={onOpenMobileFilters}
            >
              <SlidersHorizontal aria-hidden="true" />
              <span>筛选</span>
            </button>
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
      </div>

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
            onAuthor={setAuthor}
            onDiscordPrompt={onDiscordPrompt}
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
    </section>
  );
}
