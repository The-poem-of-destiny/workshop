import { MAX_SELECTED_TAGS, orderedPresetTagGroups, PROJECT_TYPES, presetTagGroup } from "@workshop/domain";
import { BookOpen, Compass, LayoutGrid, List, X } from "lucide-react";
import { type Dispatch, type RefObject, type SetStateAction, useState } from "react";

import type { CatalogueState } from "./useCatalogue";
import { SORTS } from "./useCatalogueFilters";
import type { WorkshopView } from "./useWorkshopNavigation";

export function WorkshopSidebar({
  sidebarOpen,
  isMobile,
  drawerClose,
  setSidebarOpen,
  drawerToggle,
  view,
  projectTypes,
  setView,
  setProjectTypes,
  includeContained,
  setIncludeContained,
  installedAvailable,
  installedUpdateCount,
  tags,
  tagLimitMessage,
  author,
  hasFilters,
  clearFilters,
  addTags,
  toggleTag,
  removeTag,
  pageTags,
  setAuthor,
  sort,
  setSort,
  layout,
  setLayout,
}: {
  sidebarOpen: boolean;
  isMobile: boolean;
  drawerClose: RefObject<HTMLButtonElement | null>;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  drawerToggle: RefObject<HTMLButtonElement | null>;
  view: WorkshopView;
  projectTypes: CatalogueState["projectTypes"];
  setView: (view: WorkshopView) => boolean;
  setProjectTypes: CatalogueState["setProjectTypes"];
  includeContained: CatalogueState["includeContained"];
  setIncludeContained: CatalogueState["setIncludeContained"];
  installedAvailable: boolean;
  installedUpdateCount: number | null;
  tags: CatalogueState["tags"];
  tagLimitMessage: CatalogueState["tagLimitMessage"];
  author: CatalogueState["author"];
  hasFilters: CatalogueState["hasFilters"];
  clearFilters: CatalogueState["clearFilters"];
  addTags: CatalogueState["addTags"];
  toggleTag: CatalogueState["toggleTag"];
  removeTag: CatalogueState["removeTag"];
  pageTags: CatalogueState["pageTags"];
  setAuthor: CatalogueState["setAuthor"];
  sort: CatalogueState["sort"];
  setSort: CatalogueState["setSort"];
  layout: CatalogueState["layout"];
  setLayout: CatalogueState["setLayout"];
}) {
  const [tagDraft, setTagDraft] = useState("");
  const groups = orderedPresetTagGroups(projectTypes);
  const atTagLimit = tags.length >= MAX_SELECTED_TAGS;

  function commitTagDraft(): void {
    if (!tagDraft.trim() || !setView("browse")) return;
    addTags(tagDraft.split(/[,，\n]+/));
    setTagDraft("");
  }
  return (
    <div
      id="workshop-sidebar"
      className={`sidebar${sidebarOpen ? " open" : ""}`}
      {...(isMobile
        ? { role: "dialog", "aria-modal": sidebarOpen, "aria-label": "工坊导航与筛选" }
        : { role: "complementary", "aria-label": "工坊导航与筛选" })}
      inert={isMobile && !sidebarOpen}
    >
      <div className="sidebar-drawer-head">
        <span className="sidebar-section-label">导航与筛选</span>
        <button
          ref={drawerClose}
          type="button"
          className="sidebar-close"
          aria-label="关闭导航与筛选"
          onClick={() => {
            setSidebarOpen(false);
            drawerToggle.current?.focus();
          }}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <span className="sidebar-section-label">浏览</span>
      <nav className="sidebar-nav">
        <button
          type="button"
          className={view === "browse" && projectTypes.length === 0 ? "active" : ""}
          onClick={() => {
            if (!setView("browse")) return;
            setProjectTypes([]);
            setIncludeContained(false);
            setSidebarOpen(false);
          }}
        >
          <Compass aria-hidden="true" />
          全部项目
        </button>
        {installedAvailable ? (
          <button
            type="button"
            className={view === "installed" ? "active" : ""}
            onClick={() => {
              if (!setView("installed")) return;
              setSidebarOpen(false);
            }}
          >
            <BookOpen aria-hidden="true" />
            已安装
            {installedUpdateCount !== null && installedUpdateCount > 0 ? (
              <>
                <span className="nav-badge" aria-hidden="true">
                  {installedUpdateCount}
                </span>
                <span className="sr-only">{installedUpdateCount} 个可更新</span>
              </>
            ) : null}
          </button>
        ) : null}
      </nav>
      <section className="sidebar-filters" aria-labelledby="sidebar-filter-title">
        <div className="sidebar-filter-head">
          <span id="sidebar-filter-title" className="sidebar-section-label">
            筛选
          </span>
          {hasFilters ? (
            <button
              type="button"
              className="sidebar-reset"
              onClick={() => {
                clearFilters();
                setTagDraft("");
              }}
            >
              重置
            </button>
          ) : null}
        </div>
        <fieldset className="filter-group sidebar-primary-filter" aria-describedby="primary-filter-help">
          <legend className="filter-group-label">主要分类（可多选）</legend>
          <p id="primary-filter-help" className="sidebar-filter-hint">
            多选分类满足任意一个即可（OR）。
          </p>
          <div className="filter-options">
            <button
              type="button"
              className={`filter-chip${projectTypes.length === 0 ? " active" : ""}`}
              aria-pressed={projectTypes.length === 0}
              onClick={() => {
                if (setView("browse")) setProjectTypes([]);
              }}
            >
              全部分类
            </button>
            {PROJECT_TYPES.map((value) => (
              <button
                key={value}
                type="button"
                className={`filter-chip${projectTypes.includes(value) ? " active" : ""}`}
                aria-pressed={projectTypes.includes(value)}
                onClick={() => {
                  if (!setView("browse")) return;
                  setProjectTypes(
                    projectTypes.includes(value)
                      ? projectTypes.filter((type) => type !== value)
                      : [...projectTypes, value],
                  );
                }}
              >
                {value}
              </button>
            ))}
          </div>
          <label className="sidebar-contained-toggle">
            <input
              type="checkbox"
              checked={includeContained}
              onChange={(event) => {
                if (setView("browse")) setIncludeContained(event.target.checked);
              }}
            />
            同时匹配包含该类型的项目
          </label>
        </fieldset>
        <div className="filter-group">
          <label className="filter-group-label" htmlFor="sidebar-tag">
            标签
          </label>
          <div className="sidebar-tag-input-row">
            <input
              id="sidebar-tag"
              className="sidebar-tag-input"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter" || event.key === "," || event.key === "，") {
                  event.preventDefault();
                  commitTagDraft();
                }
              }}
              placeholder="输入标签后按 Enter 添加"
              aria-describedby="sidebar-tag-help sidebar-tag-status"
              autoComplete="off"
            />
            <button type="button" className="sidebar-tag-add" disabled={!tagDraft.trim()} onClick={commitTagDraft}>
              添加
            </button>
          </div>
          <p id="sidebar-tag-help" className="sidebar-filter-hint">
            预设标签同组任选（OR）、跨组同时满足（AND）；每个自定义标签都须满足。输入预设词也按所属组匹配。
          </p>
          <p id="sidebar-tag-status" className="sidebar-filter-hint" role="status" aria-live="polite">
            {tagLimitMessage ??
              `已选 ${tags.length} / ${MAX_SELECTED_TAGS} 个标签${atTagLimit ? "，请先移除再添加。" : "。"}`}
          </p>
          {tags.length > 0 ? (
            <section className="sidebar-selected-tags" aria-label="已选筛选标签">
              {tags.map((value) => (
                <button
                  type="button"
                  key={value}
                  className="filter-chip active"
                  aria-label={`移除筛选标签 ${value}`}
                  title={presetTagGroup(value) ? `预设 · ${presetTagGroup(value)}` : "自定义标签 · AND"}
                  onClick={() => removeTag(value)}
                >
                  {value}
                  <X aria-hidden="true" />
                </button>
              ))}
            </section>
          ) : null}
          <div className="sidebar-tag-groups">
            {groups.map((group) => (
              <details
                key={group.name}
                className="sidebar-tag-group"
                open={group.tags.some((value) => tags.includes(value))}
              >
                <summary>
                  {group.name}
                  <span>{group.tags.length}</span>
                </summary>
                <fieldset className="sidebar-tags" aria-label={`${group.name}标签`}>
                  {group.tags.map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={tags.includes(value)}
                      disabled={atTagLimit && !tags.includes(value)}
                      onClick={() => {
                        if (setView("browse")) toggleTag(value);
                      }}
                    >
                      {value}
                    </button>
                  ))}
                </fieldset>
              </details>
            ))}
          </div>
          {pageTags.length > 0 ? (
            <details className="sidebar-tag-group">
              <summary>
                本页常见<span>{pageTags.length}</span>
              </summary>
              <fieldset className="sidebar-tags" aria-label="本页常见标签">
                {pageTags.map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={tags.includes(value)}
                    disabled={atTagLimit && !tags.includes(value)}
                    onClick={() => {
                      if (setView("browse")) toggleTag(value);
                    }}
                  >
                    {value}
                  </button>
                ))}
              </fieldset>
            </details>
          ) : null}
        </div>
        {author ? (
          <div className="filter-group">
            <span className="filter-group-label">作者</span>
            <p className="sidebar-author">
              <span>{author.name}</span>
              <button type="button" onClick={() => setAuthor(null)}>
                清除
              </button>
            </p>
          </div>
        ) : null}
        <div className="filter-group sidebar-sort">
          <span className="filter-group-label">排列方式</span>
          {SORTS.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="sidebar-sort"
                value={value}
                checked={sort === value}
                onChange={() => {
                  if (!setView("browse")) return;
                  setSort(value);
                }}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="filter-group sidebar-layout">
          <span className="filter-group-label">浏览方式</span>
          <div className="filter-options">
            <button
              type="button"
              className={`filter-chip${layout === "cards" ? " active" : ""}`}
              aria-pressed={layout === "cards"}
              onClick={() => setLayout("cards")}
            >
              <LayoutGrid aria-hidden="true" />
              卡片
            </button>
            <button
              type="button"
              className={`filter-chip${layout === "list" ? " active" : ""}`}
              aria-pressed={layout === "list"}
              onClick={() => setLayout("list")}
            >
              <List aria-hidden="true" />
              列表
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
