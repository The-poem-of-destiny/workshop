import { CHARACTER_FACET_OPTIONS, EXTENSION_TYPES } from "@workshop/domain";
import { BookOpen, Compass, LayoutGrid, List, X } from "lucide-react";

import { PROJECT_TYPES } from "./features/projects/projectMetadata";

import type { useCatalogue } from "./useCatalogue";
import { SORTS } from "./useCatalogueFilters";
import type { useInstalledProjects } from "./useInstalledProjects";
import type { useWorkshopNavigation } from "./useWorkshopNavigation";

export function WorkshopSidebar({
  sidebarOpen,
  isMobile,
  drawerClose,
  setSidebarOpen,
  drawerToggle,
  view,
  projectType,
  setView,
  setProjectType,
  installedAvailable,
  installedUpdateCount,
  tag,
  author,
  clearFilters,
  setTag,
  applyTag,
  pageTags,
  setAuthor,
  sort,
  setSort,
  layout,
  setLayout,
}: {
  sidebarOpen: ReturnType<typeof useWorkshopNavigation>["sidebarOpen"];
  isMobile: ReturnType<typeof useWorkshopNavigation>["isMobile"];
  drawerClose: ReturnType<typeof useWorkshopNavigation>["drawerClose"];
  setSidebarOpen: ReturnType<typeof useWorkshopNavigation>["setSidebarOpen"];
  drawerToggle: ReturnType<typeof useWorkshopNavigation>["drawerToggle"];
  view: ReturnType<typeof useWorkshopNavigation>["view"];
  projectType: ReturnType<typeof useCatalogue>["projectType"];
  setView: ReturnType<typeof useWorkshopNavigation>["setView"];
  setProjectType: ReturnType<typeof useCatalogue>["setProjectType"];
  installedAvailable: boolean;
  installedUpdateCount: ReturnType<typeof useInstalledProjects>["installedUpdateCount"];
  tag: ReturnType<typeof useCatalogue>["tag"];
  author: ReturnType<typeof useCatalogue>["author"];
  clearFilters: ReturnType<typeof useCatalogue>["clearFilters"];
  setTag: ReturnType<typeof useCatalogue>["setTag"];
  applyTag: (value: string) => void;
  pageTags: ReturnType<typeof useCatalogue>["pageTags"];
  setAuthor: ReturnType<typeof useCatalogue>["setAuthor"];
  sort: ReturnType<typeof useCatalogue>["sort"];
  setSort: ReturnType<typeof useCatalogue>["setSort"];
  layout: ReturnType<typeof useCatalogue>["layout"];
  setLayout: ReturnType<typeof useCatalogue>["setLayout"];
}) {
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
          className={view === "browse" && !projectType ? "active" : ""}
          onClick={() => {
            setView("browse");
            setProjectType("");
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
              setView("installed");
              setSidebarOpen(false);
            }}
          >
            <BookOpen aria-hidden="true" />
            已安装
            {installedUpdateCount > 0 ? (
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
          {projectType || tag.trim() || author ? (
            <button type="button" className="sidebar-reset" onClick={clearFilters}>
              重置
            </button>
          ) : null}
        </div>
        <div className="filter-group">
          <span className="filter-group-label">类型</span>
          <div className="filter-options">
            {["", ...PROJECT_TYPES].map((value) => (
              <button
                key={value || "all"}
                type="button"
                className={`filter-chip${projectType === value ? " active" : ""}`}
                aria-pressed={projectType === value}
                onClick={() => {
                  setView("browse");
                  setProjectType(value);
                  setSidebarOpen(false);
                }}
              >
                {value || "全部"}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <label className="filter-group-label" htmlFor="sidebar-tag">
            标签
          </label>
          <input
            id="sidebar-tag"
            className="sidebar-tag-input"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            placeholder="按标签筛选"
            autoComplete="off"
          />
          <p className="sidebar-filter-hint">
            {projectType === "角色"
              ? "下方为官方角色标签，点击即可筛选；也可以直接输入自定义标签。"
              : projectType === "扩展"
                ? `扩展类型（${EXTENSION_TYPES.join(" / ")}）是独立字段，不作为标签；可直接输入自定义标签筛选。`
                : "官方标签按项目类型提供；也可以直接输入自定义标签筛选。"}
          </p>
          {tag.trim() ? (
            <p className="sidebar-active-tag">
              <span>当前标签：{tag}</span>
              <button type="button" onClick={() => setTag("")}>
                清除
              </button>
            </p>
          ) : null}
          {projectType === "角色" ? (
            <div className="sidebar-tag-groups">
              {(Object.keys(CHARACTER_FACET_OPTIONS) as Array<keyof typeof CHARACTER_FACET_OPTIONS>).map((group) => (
                <details key={group} className="sidebar-tag-group">
                  <summary>
                    官方 · {group}
                    <span>{CHARACTER_FACET_OPTIONS[group].length}</span>
                  </summary>
                  <fieldset className="sidebar-tags" aria-label={`${group}标签`}>
                    {(CHARACTER_FACET_OPTIONS[group] as readonly string[]).map((value) => (
                      <button type="button" key={value} aria-pressed={tag === value} onClick={() => applyTag(value)}>
                        {value}
                      </button>
                    ))}
                  </fieldset>
                </details>
              ))}
            </div>
          ) : null}
          {pageTags.length > 0 ? (
            <details className="sidebar-tag-group">
              <summary>
                本页常见<span>{pageTags.length}</span>
              </summary>
              <fieldset className="sidebar-tags" aria-label="本页常见标签">
                {pageTags.map((value) => (
                  <button type="button" key={value} aria-pressed={tag === value} onClick={() => applyTag(value)}>
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
                  setSort(value);
                  setView("browse");
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
