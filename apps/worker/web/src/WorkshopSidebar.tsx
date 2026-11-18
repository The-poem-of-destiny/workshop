import { MAX_SELECTED_TAGS, orderedPresetTagGroups, PROJECT_TYPES, presetTagGroup } from "@workshop/domain";
import { BookOpen, Compass, X } from "lucide-react";
import { type Dispatch, type RefObject, type SetStateAction, useState } from "react";

import type { CatalogueState } from "./useCatalogue";
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
  collection,
  hasFilters,
  clearFilters,
  addTags,
  toggleTag,
  removeTag,
  pageTags,
  setAuthor,
  setCollection,
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
  collection: CatalogueState["collection"];
  hasFilters: CatalogueState["hasFilters"];
  clearFilters: CatalogueState["clearFilters"];
  addTags: CatalogueState["addTags"];
  toggleTag: CatalogueState["toggleTag"];
  removeTag: CatalogueState["removeTag"];
  pageTags: CatalogueState["pageTags"];
  setAuthor: CatalogueState["setAuthor"];
  setCollection: CatalogueState["setCollection"];
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
      <nav className="sidebar-nav" aria-label="浏览范围">
        <button
          type="button"
          className={view === "browse" && !hasFilters ? "active" : ""}
          onClick={() => {
            if (!setView("browse")) return;
            clearFilters();
            setTagDraft("");
            setSidebarOpen(false);
          }}
        >
          <Compass aria-hidden="true" />
          全部作品
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
            目录筛选
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
        <fieldset className="filter-group sidebar-primary-filter">
          <legend className="filter-group-label">主要分类</legend>
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
              placeholder="输入标签后按 Enter"
              aria-describedby="sidebar-tag-status"
              autoComplete="off"
            />
            <button type="button" className="sidebar-tag-add" disabled={!tagDraft.trim()} onClick={commitTagDraft}>
              添加
            </button>
          </div>
          <p id="sidebar-tag-status" className="sidebar-filter-hint" role="status" aria-live="polite">
            {tagLimitMessage ??
              (tags.length > 0
                ? `已选 ${tags.length} / ${MAX_SELECTED_TAGS} 个标签${atTagLimit ? "，请先移除再添加。" : ""}`
                : "可多选标签组合筛选")}
          </p>
          {tags.length > 0 ? (
            <section className="sidebar-selected-tags" aria-label="已选筛选标签">
              {tags.map((value) => (
                <button
                  type="button"
                  key={value}
                  className="filter-chip active"
                  aria-label={`移除筛选标签 ${value}`}
                  title={presetTagGroup(value) ? `预设 · ${presetTagGroup(value)}` : "自定义标签"}
                  onClick={() => removeTag(value)}
                >
                  {value}
                  <X aria-hidden="true" />
                </button>
              ))}
            </section>
          ) : null}
          <div className="sidebar-tag-groups">
            {groups.map((group) => {
              const selectedCount = group.tags.filter((value) => tags.includes(value)).length;
              return (
                <details
                  key={group.name}
                  className={`sidebar-tag-group${selectedCount > 0 ? " has-active" : ""}`}
                  open={selectedCount > 0}
                >
                  <summary>
                    {group.name}
                    <span>{selectedCount > 0 ? `已选 ${selectedCount}` : group.tags.length}</span>
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
              );
            })}
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
        {collection ? (
          <div className="filter-group">
            <span className="filter-group-label">合集</span>
            <p className="sidebar-author sidebar-collection">
              <span>{collection.title}</span>
              <button type="button" onClick={() => setCollection(null)}>
                清除
              </button>
            </p>
          </div>
        ) : null}
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
      </section>
    </div>
  );
}
