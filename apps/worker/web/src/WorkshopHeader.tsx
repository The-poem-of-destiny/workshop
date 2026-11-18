import {
  CircleHelp,
  CircleUserRound,
  Compass,
  FolderKanban,
  Link2,
  Link2Off,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import type { useCatalogue } from "./useCatalogue";
import type { useHostConnection } from "./useHostConnection";
import type { useWorkshopNavigation, WorkshopView } from "./useWorkshopNavigation";
import type { useWorkshopSession } from "./useWorkshopSession";

export function WorkshopHeader({
  headerRef,
  isMobile,
  sidebarOpen,
  sidebarCollapsed,
  setSidebarCollapsed,
  search,
  setSearch,
  setView,
  confirmLeave,
  connectionStatus,
  connectionLabel,
  connectionTitle,
  embedded,
  postToHost,
  me,
  pendingPolicyUser,
  onOpenPolicy,
  onOpenFaq,
  avatarFailed,
  setAvatarFailed,
  logout,
  login,
  drawerToggle,
  setSidebarOpen,
  hasFilters,
  view,
  reviewer,
}: {
  headerRef: ReturnType<typeof useWorkshopNavigation>["headerRef"];
  isMobile: ReturnType<typeof useWorkshopNavigation>["isMobile"];
  sidebarOpen: ReturnType<typeof useWorkshopNavigation>["sidebarOpen"];
  sidebarCollapsed: ReturnType<typeof useWorkshopNavigation>["sidebarCollapsed"];
  setSidebarCollapsed: ReturnType<typeof useWorkshopNavigation>["setSidebarCollapsed"];
  search: ReturnType<typeof useCatalogue>["search"];
  setSearch: ReturnType<typeof useCatalogue>["setSearch"];
  setView: (view: WorkshopView) => boolean;
  confirmLeave: () => boolean;
  connectionStatus: ReturnType<typeof useHostConnection>["connectionStatus"];
  connectionLabel: ReturnType<typeof useHostConnection>["connectionLabel"];
  connectionTitle: ReturnType<typeof useHostConnection>["connectionTitle"];
  embedded: boolean;
  postToHost: ReturnType<typeof useHostConnection>["postToHost"];
  me: ReturnType<typeof useWorkshopSession>["me"];
  pendingPolicyUser: ReturnType<typeof useWorkshopSession>["pendingPolicyUser"];
  onOpenPolicy: () => void;
  onOpenFaq: () => void;
  avatarFailed: boolean;
  setAvatarFailed: (failed: boolean) => void;
  logout: ReturnType<typeof useWorkshopSession>["logout"];
  login: ReturnType<typeof useWorkshopSession>["login"];
  drawerToggle: ReturnType<typeof useWorkshopNavigation>["drawerToggle"];
  setSidebarOpen: ReturnType<typeof useWorkshopNavigation>["setSidebarOpen"];
  hasFilters: boolean;
  view: ReturnType<typeof useWorkshopNavigation>["view"];
  reviewer: boolean;
}) {
  return (
    <header ref={headerRef} className="site-header" inert={isMobile && sidebarOpen}>
      <div className="header-brand">
        <button
          ref={drawerToggle}
          type="button"
          className="drawer-toggle"
          aria-expanded={sidebarOpen}
          aria-controls="workshop-sidebar"
          aria-label="打开导航与筛选"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu aria-hidden="true" />
          {hasFilters ? <span className="drawer-toggle-dot" aria-hidden="true" /> : null}
        </button>
        {view === "browse" ? (
          <button
            type="button"
            className="sidebar-toggle"
            aria-expanded={!sidebarCollapsed}
            aria-controls="workshop-sidebar"
            aria-label={sidebarCollapsed ? "展开筛选栏" : "收起筛选栏"}
            title={sidebarCollapsed ? "展开筛选栏" : "收起筛选栏"}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </button>
        ) : null}
        <button
          type="button"
          className="brand-lockup brand-home-button"
          onClick={() => setView("browse")}
          title="返回创意工坊首页"
        >
          <span className="eyebrow">命定之诗与黄昏之歌</span>
          <h1>创意工坊</h1>
        </button>
      </div>

      <div className="header-center">
        {!isMobile || view === "browse" ? (
          <div className="header-search">
            <Search aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                if (!setView("browse")) return;
                setSearch(event.target.value);
              }}
              placeholder="搜索作品、作者、标签…"
              aria-label="搜索"
            />
          </div>
        ) : null}
        {me ? (
          <nav className="personal-nav" aria-label="个人导航">
            <button
              type="button"
              aria-current={view === "browse" ? "page" : undefined}
              onClick={() => setView("browse")}
            >
              <Compass aria-hidden="true" />
              浏览工坊
            </button>
            <button
              type="button"
              aria-current={view === "projects" ? "page" : undefined}
              onClick={() => setView("projects")}
            >
              <FolderKanban aria-hidden="true" />
              我的项目
            </button>
            <button
              type="button"
              aria-current={view === "create" ? "page" : undefined}
              onClick={() => setView("create")}
            >
              <Plus aria-hidden="true" />
              创建项目
            </button>
            <button type="button" aria-current={view === "subs" ? "page" : undefined} onClick={() => setView("subs")}>
              <CircleUserRound aria-hidden="true" />
              我的订阅
            </button>
            {reviewer ? (
              <button
                type="button"
                aria-current={view === "admin" ? "page" : undefined}
                onClick={() => setView("admin")}
              >
                <ShieldCheck aria-hidden="true" />
                审核台
              </button>
            ) : null}
            {me.role === "owner" ? (
              <button
                type="button"
                aria-current={view === "tools" ? "page" : undefined}
                onClick={() => setView("tools")}
              >
                <SlidersHorizontal aria-hidden="true" />
                管理
              </button>
            ) : null}
          </nav>
        ) : null}
      </div>

      <div className="header-account">
        <button
          type="button"
          className="header-help-button"
          onClick={onOpenFaq}
          title="使用帮助与常见问题"
          aria-label="使用帮助与常见问题"
        >
          <CircleHelp aria-hidden="true" />
          <span>帮助</span>
        </button>
        {embedded || connectionStatus === "connected" || connectionStatus === "connecting" ? (
          <span
            role="status"
            className={`tavern-status ${connectionStatus}`}
            aria-label={`SillyTavern ${connectionLabel}`}
            title={connectionTitle}
          >
            {connectionStatus === "connected" || connectionStatus === "connecting" ? (
              <Link2 aria-hidden="true" />
            ) : (
              <Link2Off aria-hidden="true" />
            )}
            <span>{connectionLabel}</span>
          </span>
        ) : null}
        {embedded ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="close-workshop"
            onClick={() => {
              if (confirmLeave()) postToHost({ type: "cw:close" });
            }}
          >
            {isMobile ? "关闭" : "关闭工坊"}
          </Button>
        ) : null}
        {me ? (
          <div className="account">
            {me.avatarUrl && !avatarFailed ? (
              <img className="account-avatar" src={me.avatarUrl} alt="" onError={() => setAvatarFailed(true)} />
            ) : (
              <span className="account-avatar account-initial">{(me.globalName || me.username).slice(0, 1)}</span>
            )}
            <span>{me.globalName || me.username}</span>
            <Button type="button" size="sm" variant="ghost" onClick={logout}>
              退出
            </Button>
          </div>
        ) : pendingPolicyUser ? (
          <div className="account account-pending-policy">
            <button type="button" className="policy-pending-trigger" onClick={onOpenPolicy}>
              <ShieldAlert aria-hidden="true" />
              <span>完成确认</span>
            </button>
            <Button type="button" size="sm" variant="ghost" onClick={logout}>
              退出
            </Button>
          </div>
        ) : (
          <Button type="button" className="login" onClick={login}>
            <img className="discord-icon" src="/discord.svg" alt="" />
            <span>{isMobile ? "登录" : "Discord 登录"}</span>
          </Button>
        )}
      </div>
    </header>
  );
}
