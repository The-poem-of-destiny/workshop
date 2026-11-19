import {
  CircleHelp,
  CircleUserRound,
  Compass,
  FolderKanban,
  Link2,
  Link2Off,
  Menu,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import type { useCatalogue } from "../features/catalogue/useCatalogue";
import type { useHostConnection } from "../features/installed/useHostConnection";
import type { useWorkshopNavigation, WorkshopView } from "./useWorkshopNavigation";
import type { useWorkshopSession } from "./useWorkshopSession";

export function WorkshopHeader({
  headerRef,
  isMobile,
  sidebarOpen,
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
            {(
              [
                ["browse", Compass, "浏览工坊", true],
                ["projects", FolderKanban, "我的项目", true],
                ["create", Plus, "创建项目", true],
                ["subs", CircleUserRound, "我的订阅", true],
                ["admin", ShieldCheck, "审核台", reviewer],
                ["tools", SlidersHorizontal, "管理", me.role === "owner"],
              ] as const
            ).map(([target, Icon, label, show]) =>
              show ? (
                <button
                  key={target}
                  type="button"
                  aria-current={view === target ? "page" : undefined}
                  onClick={() => setView(target)}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </button>
              ) : null,
            )}
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
