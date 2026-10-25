import { CHARACTER_FACET_OPTIONS, EXTENSION_TYPES } from "@workshop/domain";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Compass,
  FolderKanban,
  LayoutGrid,
  Link2,
  Link2Off,
  List,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { AdminTools } from "./AdminTools";
import { ApiError, api, type HomeResponse, type MeResponse, type ProjectSummary, setSessionToken } from "./api";
import { Button } from "./components/ui/button";
import { ConfirmDialog } from "./components/ui/confirm-dialog";
import { Input } from "./components/ui/input";
import { InstallDialog } from "./features/installed/InstallDialog";
import {
  Installed,
  type InstalledItem,
  type InstalledRecord,
  type InstalledScanState,
} from "./features/installed/Installed";
import { CreateProject } from "./features/projects/CreateProject";
import { Discovery } from "./features/projects/Discovery";
import { MyProjects } from "./features/projects/MyProjects";
import { ProjectCard } from "./features/projects/ProjectCard";
import { type InstallState, ProjectDetail } from "./features/projects/ProjectDetail";
import { PROJECT_TYPES } from "./features/projects/projectMetadata";
import { Subscriptions } from "./features/projects/Subscriptions";
import { AdminPanel } from "./features/review/AdminPanel";

const SORTS = [
  ["updated", "最近更新"],
  ["published", "发布时间"],
  ["downloads", "下载"],
  ["likes", "点赞"],
] as const;
const SIDEBAR_STORAGE_KEY = "cw_sidebar_collapsed";
const SIDEBAR_MOBILE_QUERY = "(max-width: 1023px)";
const CONNECTION_LABELS = {
  disconnected: "未连接",
  connecting: "连接中",
  connected: "已连接",
  error: "连接出错",
} as const;
type ConnectionState = keyof typeof CONNECTION_LABELS;

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(SIDEBAR_MOBILE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(SIDEBAR_MOBILE_QUERY);
    const update = (): void => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isMobile;
}

interface HostContext {
  connected: boolean;
  characterName: string | null;
  worldbooks: { primary: string | null; additional: string[]; available: string[] };
  registry: Record<string, InstalledRecord>;
  installStates?: Record<string, InstalledScanState>;
  clientVersion: string;
  error?: string;
}

export function App() {
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [layout, setLayout] = useState<"cards" | "list">(() => {
    try {
      return localStorage.getItem("cw_catalogue_layout") === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });
  const [pageSize, setPageSize] = useState(25);
  const [paging, setPaging] = useState<{ key: string; cursors: (string | undefined)[]; index: number }>({
    key: "",
    cursors: [undefined],
    index: 0,
  });
  const [listLoading, setListLoading] = useState(true);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [listRetry, setListRetry] = useState(0);
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
  const [selected, setSelected] = useState<ProjectSummary | null>(null);
  const [newlyCreatedProjectId, setNewlyCreatedProjectId] = useState<string | null>(null);
  const detailOpener = useRef<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [context, setContext] = useState<HostContext | null>(null);
  const [installing, setInstalling] = useState(false);
  const hostMutationPending = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<ProjectSummary | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<{ id: string; title: string; worldbookName: string } | null>(
    null,
  );
  const [installConflicts, setInstallConflicts] = useState<string[] | null>(null);
  const [installedProjects, setInstalledProjects] = useState<Record<string, ProjectSummary | null | undefined>>({});
  const [installedFailed, setInstalledFailed] = useState<Record<string, true>>({});
  const [installedReload, setInstalledReload] = useState(0);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [loginFallback, setLoginFallback] = useState<string | null>(null);
  const [view, setView] = useState<"browse" | "projects" | "create" | "subs" | "admin" | "tools" | "installed">(() => {
    const requested = import.meta.env.DEV ? new URLSearchParams(location.search).get("debug-view") : null;
    return requested === "projects" ||
      requested === "create" ||
      requested === "subs" ||
      requested === "admin" ||
      requested === "tools" ||
      requested === "installed"
      ? requested
      : "browse";
  });
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(() => {
      header.parentElement?.style.setProperty("--header-height", `${header.getBoundingClientRect().height}px`);
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => setAvatarFailed(false), [me?.avatarUrl]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [subscriptionOverrides, setSubscriptionOverrides] = useState<Record<string, boolean>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setSubscriptionOverrides({});
  }, [view]);
  useEffect(() => {
    setSidebarOpen(false);
  }, [view, isMobile]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* storage may be unavailable */
    }
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => drawerClose.current?.focus());
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      } else if (event.key === "Tab") {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            "#workshop-sidebar button:not(:disabled), #workshop-sidebar input, #workshop-sidebar a[href]",
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!document.getElementById("workshop-sidebar")?.contains(document.activeElement)) {
          event.preventDefault();
          first?.focus();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", dismiss);
      queueMicrotask(() => {
        const toggle = drawerToggle.current;
        if (toggle && toggle.getClientRects().length > 0) toggle.focus();
        else document.querySelector<HTMLButtonElement>(".sidebar-toggle")?.focus();
      });
    };
  }, [isMobile, sidebarOpen]);
  const listRequest = useRef(0);
  const embedded = new URLSearchParams(location.search).get("embed") === "1";
  function postToHost(payload: Record<string, unknown>): void {
    if (window.parent !== window) window.parent.postMessage(payload, "*");
  }
  async function refreshMe(): Promise<void> {
    if (!api.hasSession()) return;
    try {
      const value = await api.me();
      setMe(value.user);
    } catch {
      setSessionToken(null);
      setMe(null);
    }
  }
  function login(): void {
    setError(null);
    setLoginFallback(null);
    const mode = embedded ? "device" : "browser";
    void api
      .createFlow(mode)
      .then(async (flow) => {
        if (mode === "browser") {
          const onMessage = (event: MessageEvent): void => {
            if (event.origin !== location.origin) return;
            const data: { type?: unknown; token?: unknown } = event.data;
            if (data.type !== "oauth-success" || typeof data.token !== "string") return;
            setSessionToken(data.token);
            setLoginFallback(null);
            window.removeEventListener("message", onMessage);
            void refreshMe();
          };
          window.addEventListener("message", onMessage);
        }
        const popup = window.open(flow.url, "cw-discord-login", "width=520,height=720");
        if (!popup) {
          setLoginFallback(flow.url);
          setNotice("请在打开的新页面完成 Discord 登录，本页会自动继续。");
        }
        if (mode !== "device" || !flow.deviceCode) return;
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const status = await api.authFlowStatus(flow.id, flow.deviceCode);
          if (status.status === "authorized") {
            const session = await api.redeemFlow(flow.id, flow.deviceCode);
            setSessionToken(session.token);
            setLoginFallback(null);
            setNotice("登录成功。");
            await refreshMe();
            return;
          }
          if (status.status === "expired") {
            setError("登录已过期，请重新发起。");
            return;
          }
          if (status.status === "redeemed") {
            setError("登录凭据已被使用，请重新发起。");
            return;
          }
        }
        setError("等待登录超时，请重新发起。");
      })
      .catch((reason) => setError(String(reason)));
  }
  function logout(): void {
    void api.logout().finally(() => {
      setMe(null);
      setView("browse");
    });
  }
  async function performInstall(project: ProjectSummary, targetWorldbook: string): Promise<void> {
    if (hostMutationPending.current) return;
    if (!me) {
      login();
      return;
    }
    hostMutationPending.current = true;
    setInstalling(true);
    setUpdatingId(project.id);
    setInstallConflicts(null);
    setNotice(null);
    setError(null);
    try {
      const payload = await api.acquisitions(project.id);
      const files: { worldbook?: string; regex?: string } = {};
      for (const ticket of payload.tickets) {
        files[ticket.kind] = await api.downloadTicketText(ticket.url);
      }
      postToHost({
        type: "cw:install",
        project: payload.project,
        files,
        targetWorldbook,
      });
    } catch (reason) {
      setError(String(reason));
      hostMutationPending.current = false;
      setInstalling(false);
      setUpdatingId(null);
    }
  }
  function install(project: ProjectSummary): void {
    if (hostMutationPending.current) return;
    if (!context?.connected) {
      setError("没有检测到 SillyTavern 上下文，请从酒馆内打开。");
      return;
    }
    if (!me) {
      login();
      return;
    }
    const record = context.registry?.[project.id];
    if (record?.worldbookName) {
      void performInstall(project, record.worldbookName);
      return;
    }
    setInstallTarget(project);
  }
  function requestUninstall(target: { id: string; title: string }): void {
    if (hostMutationPending.current) return;
    const worldbookName = context?.registry?.[target.id]?.worldbookName ?? "当前世界书";
    setUninstallTarget({ id: target.id, title: target.title, worldbookName });
  }
  function confirmUninstall(): void {
    if (!uninstallTarget || hostMutationPending.current) return;
    hostMutationPending.current = true;
    setInstalling(true);
    postToHost({ type: "cw:uninstall", projectId: uninstallTarget.id });
    setUninstallTarget(null);
  }
  function chooseInstallTarget(worldbookName: string): void {
    const project = installTarget;
    setInstallTarget(null);
    if (project) void performInstall(project, worldbookName);
  }
  function rescanInstalls(): void {
    setScanning(true);
    setError(null);
    postToHost({ type: "cw:scan" });
  }
  useEffect(() => {
    api
      .home()
      .then(setHome)
      .catch((reason) => setError(String(reason)));
    void refreshMe();
    if (embedded) postToHost({ type: "cw:ready" });
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window.parent) return;
      const data: { type?: unknown; [key: string]: unknown } = event.data;
      if (typeof data.type !== "string") return;
      if (data.type === "cw:context") setContext(data as unknown as HostContext);
      else if (data.type === "cw:install-result") {
        setInstalling(false);
        hostMutationPending.current = false;
        setUpdatingId(null);
        setNotice(data.ok ? "安装完成。" : `安装失败：${String(data.message ?? "")}`);
        if (data.ok) {
          const conflicts = Array.isArray(data.conflicts)
            ? data.conflicts.filter((value): value is string => typeof value === "string")
            : [];
          setInstallConflicts(conflicts.length > 0 ? conflicts : null);
          postToHost({ type: "cw:request-context" });
        }
      } else if (data.type === "cw:uninstall-result") {
        setInstalling(false);
        hostMutationPending.current = false;
        const preservedEntries = Number(data.preservedEntries ?? 0);
        const preservedRegexes = Number(data.preservedRegexes ?? 0);
        setNotice(
          data.ok
            ? preservedEntries + preservedRegexes > 0
              ? `卸载完成；保留了 ${preservedEntries} 个玩家修改条目、${preservedRegexes} 条玩家修改正则。`
              : "卸载完成。"
            : `卸载失败：${String(data.message ?? "")}`,
        );
        if (data.ok) postToHost({ type: "cw:request-context" });
      } else if (data.type === "cw:scan-result") {
        setScanning(false);
        if (data.ok) {
          setContext((previous) =>
            previous
              ? {
                  ...previous,
                  registry: (data.registry as HostContext["registry"]) ?? previous.registry,
                  installStates: (data.installStates as HostContext["installStates"]) ?? previous.installStates,
                }
              : previous,
          );
        } else {
          setError(`重新扫描失败：${String(data.message ?? "")}`);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded]);
  const queryKey = JSON.stringify([search.trim(), sort, projectType, author?.id, tag.trim(), pageSize]);
  const pageIndex = paging.key === queryKey ? paging.index : 0;
  const pageCursors = paging.key === queryKey ? paging.cursors : [undefined];
  const pageCursor = pageCursors[pageIndex];
  useEffect(() => {
    let cancelled = false;
    const requestId = ++listRequest.current;
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
  }, [search, sort, projectType, author, tag, pageCursor, pageSize, queryKey, listRetry]);
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
  function installationState(project: ProjectSummary): InstallState {
    const record = context?.registry?.[project.id];
    if (!record) return "notInstalled";
    if (project.publishedRevisionId && record.version !== project.publishedRevisionId) return "updateAvailable";
    const scan = context?.installStates?.[project.id];
    if (scan === "localChanged") return "localChanged";
    if (scan === "scanIncomplete" || !scan) return "scanIncomplete";
    return "upToDate";
  }
  const selectedInstallState = selected ? installationState(selected) : "notInstalled";
  const registryKey = JSON.stringify(context?.registry ?? {});
  // `newlyCreatedProjectId` is a one-shot hint for the MyProjects mount; clearing it keeps later visits neutral.
  useEffect(() => {
    if (newlyCreatedProjectId === null) return;
    setNewlyCreatedProjectId(null);
  }, [newlyCreatedProjectId]);
  useEffect(() => {
    if (!context?.connected) {
      setInstalledProjects({});
      setInstalledFailed({});
      setInstalledLoading(false);
      return;
    }
    const ids = Object.keys(context.registry ?? {});
    if (ids.length === 0) {
      setInstalledProjects({});
      setInstalledFailed({});
      setInstalledLoading(false);
      return;
    }
    let active = true;
    setInstalledLoading(true);
    void Promise.all(
      ids.map(async (id) => {
        try {
          return { id, project: await api.project(id), failed: false } as const;
        } catch (reason) {
          // A 404 means the project left the workshop; anything else is a transient lookup failure.
          if (reason instanceof ApiError && reason.status === 404) return { id, project: null, failed: false } as const;
          return { id, project: null, failed: true } as const;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      setInstalledProjects(Object.fromEntries(entries.map((entry) => [entry.id, entry.project] as const)));
      setInstalledFailed(
        Object.fromEntries(entries.filter((entry) => entry.failed).map((entry) => [entry.id, true] as const)),
      );
      setInstalledLoading(false);
    });
    return () => {
      active = false;
    };
  }, [context?.connected, registryKey, installedReload]);
  function clearFilters(): void {
    setSearch("");
    setProjectType("");
    setTag("");
    setAuthor(null);
  }
  function applyTag(value: string): void {
    setView("browse");
    setTag((current) => (current === value ? "" : value));
    setSidebarOpen(false);
  }
  const hasFilters = Boolean(search.trim() || projectType || author || tag.trim());
  const pageTags = [...new Set(projects.flatMap((project) => project.tags))].slice(0, 10);
  const installedAvailable = embedded || Boolean(context?.connected);
  const installedItems: InstalledItem[] = Object.entries(context?.registry ?? {}).map(([id, record]) => ({
    id,
    record,
    project: installedProjects[id],
    failed: Boolean(installedFailed[id]),
  }));
  const installedPending = installedItems.some((item) => item.project === undefined && !item.failed);
  const installedUpdateCount = installedItems.filter(
    (item) =>
      !item.failed &&
      Boolean(item.project?.publishedRevisionId && item.record.version !== item.project.publishedRevisionId),
  ).length;
  function reloadInstalledProjects(): void {
    setInstalledReload((value) => value + 1);
  }
  const connectionStatus: ConnectionState =
    context === null
      ? embedded
        ? "connecting"
        : "disconnected"
      : context.error
        ? "error"
        : context.connected
          ? "connected"
          : "disconnected";
  const connectionLabel = CONNECTION_LABELS[connectionStatus];
  const connectionTitle =
    connectionStatus === "connected"
      ? `SillyTavern 已连接 · 当前角色：${context?.characterName ?? "未选择"}`
      : connectionStatus === "connecting"
        ? "正在连接 SillyTavern…"
        : connectionStatus === "error"
          ? `SillyTavern 连接出错：${context?.error ?? "未知原因"}`
          : "请从 SillyTavern 内打开工坊以导入项目";
  const reviewer = me?.role === "reviewer" || me?.role === "owner";
  return (
    <div className={`shell${embedded ? " embedded" : ""}${me ? " authenticated" : ""}`}>
      <header ref={headerRef} className="site-header" inert={isMobile && sidebarOpen}>
        <div className="header-brand">
          <button
            type="button"
            className="sidebar-toggle"
            aria-expanded={!sidebarCollapsed}
            aria-controls="workshop-sidebar"
            aria-label={sidebarCollapsed ? "展开导航与筛选" : "收起导航与筛选"}
            title={sidebarCollapsed ? "展开导航与筛选" : "收起导航与筛选"}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </button>
          <div className="brand-lockup">
            <p className="eyebrow">命定之诗与黄昏之歌</p>
            <h1>创意工坊</h1>
          </div>
        </div>
        <div className="header-search">
          <Search aria-hidden="true" />
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setView("browse");
            }}
            placeholder="搜索项目、作者、标签"
            aria-label="搜索"
          />
        </div>
        <div className="header-account">
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
          {embedded ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="close-workshop"
              onClick={() => postToHost({ type: "cw:close" })}
            >
              关闭工坊
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
          ) : (
            <Button type="button" className="login" onClick={login}>
              <img className="discord-icon" src="/discord.svg" alt="" />
              Discord 登录
            </Button>
          )}
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
            {projectType || tag.trim() || author ? <span className="drawer-toggle-dot" aria-hidden="true" /> : null}
          </button>
        </div>
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
      </header>
      <div className={`shell-body${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        {isMobile && sidebarOpen ? (
          <button
            type="button"
            className="sidebar-scrim"
            tabIndex={-1}
            aria-label="关闭导航与筛选"
            onClick={() => {
              setSidebarOpen(false);
              drawerToggle.current?.focus();
            }}
          />
        ) : null}
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
                  {(Object.keys(CHARACTER_FACET_OPTIONS) as Array<keyof typeof CHARACTER_FACET_OPTIONS>).map(
                    (group) => (
                      <details key={group} className="sidebar-tag-group">
                        <summary>
                          官方 · {group}
                          <span>{CHARACTER_FACET_OPTIONS[group].length}</span>
                        </summary>
                        <fieldset className="sidebar-tags" aria-label={`${group}标签`}>
                          {(CHARACTER_FACET_OPTIONS[group] as readonly string[]).map((value) => (
                            <button
                              type="button"
                              key={value}
                              aria-pressed={tag === value}
                              onClick={() => applyTag(value)}
                            >
                              {value}
                            </button>
                          ))}
                        </fieldset>
                      </details>
                    ),
                  )}
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
        <main className="workshop-main" inert={isMobile && sidebarOpen}>
          {home?.banner?.imageUrl && view === "browse" ? (
            <div
              className="banner"
              style={
                {
                  backgroundImage: `url(${home.banner.imageUrl})`,
                  "--banner-x": `${home.banner.positionX}%`,
                  "--banner-y": `${home.banner.positionY}%`,
                  "--banner-mobile-x": `${home.banner.mobilePositionX ?? home.banner.positionX}%`,
                  "--banner-mobile-y": `${home.banner.mobilePositionY ?? home.banner.positionY}%`,
                  "--banner-size": home.banner.zoom > 1 ? `${home.banner.zoom * 100}% auto` : "cover",
                  "--banner-mobile-size":
                    (home.banner.mobileZoom ?? home.banner.zoom) > 1
                      ? `${(home.banner.mobileZoom ?? home.banner.zoom) * 100}% auto`
                      : "cover",
                } as CSSProperties
              }
            />
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
              <button type="button" onClick={() => setError(null)} aria-label="关闭提示">
                ×
              </button>
            </p>
          ) : null}
          {loginFallback ? (
            <p className="notice">
              <a href={loginFallback} target="_blank" rel="noopener opener">
                打开 Discord 登录页
              </a>
            </p>
          ) : null}
          {notice ? (
            <div className="toast" role="status">
              <span>{notice}</span>
              <button type="button" aria-label="关闭通知" onClick={() => setNotice(null)}>
                <X aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {installConflicts ? (
            <section className="conflicts-panel" role="status" aria-label="安装冲突提示">
              <div className="conflicts-panel-head">
                <strong>安装完成，部分条目已保留原有内容</strong>
                <button type="button" aria-label="关闭冲突提示" onClick={() => setInstallConflicts(null)}>
                  <X aria-hidden="true" />
                </button>
              </div>
              <p className="conflicts-panel-hint">
                为避免覆盖你在 SillyTavern 中的改动，以下条目未被替换。确认无误后可以手动处理。
              </p>
              <ul>
                {[...new Set(installConflicts)].map((conflict) => (
                  <li key={conflict}>{conflict}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {view === "create" && me ? (
            <CreateProject
              onCreated={(projectId) => {
                setNewlyCreatedProjectId(projectId);
                setView("projects");
              }}
              onCancel={() => setView("projects")}
              onError={setError}
              onNotice={setNotice}
            />
          ) : view === "projects" && me ? (
            <MyProjects
              initialSelectedId={newlyCreatedProjectId}
              onCreate={() => setView("create")}
              onError={(message) => {
                setError(message);
                setNotice(null);
              }}
              onNotice={(message) => {
                setNotice(message);
                setError(null);
              }}
            />
          ) : view === "subs" && me ? (
            <Subscriptions
              subscriptionOverrides={subscriptionOverrides}
              onOpen={(project, opener) => {
                detailOpener.current = opener;
                setSelected(project);
              }}
              onError={(message) => {
                setError(message);
                setNotice(null);
              }}
            />
          ) : view === "admin" && reviewer ? (
            <AdminPanel
              onError={(message) => {
                setError(message);
                setNotice(null);
              }}
              onNotice={(message) => {
                setNotice(message);
                setError(null);
              }}
            />
          ) : view === "tools" && me?.role === "owner" ? (
            <AdminTools
              onError={(message) => {
                setError(message);
                setNotice(null);
              }}
              onNotice={(message) => {
                setNotice(message);
                setError(null);
              }}
            />
          ) : view === "installed" && installedAvailable ? (
            <Installed
              items={installedItems}
              states={context?.installStates}
              loading={installedLoading || installedPending || (embedded && context === null)}
              scanning={scanning}
              updatingId={updatingId}
              mutating={installing}
              onScan={rescanInstalls}
              onRetry={reloadInstalledProjects}
              onOpen={(item) => {
                if (!item.project) return;
                detailOpener.current = null;
                setSelected(item.project);
              }}
              onUpdate={(item) => {
                if (!item.project) return;
                void performInstall(item.project, item.record.worldbookName);
              }}
              onUninstall={(item) => requestUninstall({ id: item.id, title: item.project?.title ?? item.id })}
            />
          ) : (
            <>
              {hasFilters ? (
                <section className="active-filters" aria-label="当前筛选条件">
                  <span className="active-filters-label">筛选</span>
                  {search.trim() ? (
                    <button
                      type="button"
                      className="filter-chip active"
                      onClick={() => setSearch("")}
                      title="移除搜索条件"
                    >
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
                    <button
                      type="button"
                      className="filter-chip active"
                      onClick={() => setAuthor(null)}
                      title="移除作者筛选"
                    >
                      作者：{author.name}
                      <X aria-hidden="true" />
                    </button>
                  ) : null}
                  {tag.trim() ? (
                    <button
                      type="button"
                      className="filter-chip active"
                      onClick={() => setTag("")}
                      title="移除标签筛选"
                    >
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
                      ? ""
                      : `第 ${pageIndex * pageSize + 1}–${pageIndex * pageSize + projects.length} 条 · 第 ${pageIndex + 1} 页`}
              </p>
              {!listLoading && loadedQuery !== queryKey ? (
                <button type="button" onClick={() => setListRetry((value) => value + 1)}>
                  重新加载
                </button>
              ) : null}
              <div
                className={`grid catalogue-grid${layout === "list" ? " catalogue-list" : ""}`}
                aria-busy={listLoading}
              >
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
          )}
          {selected ? (
            <ProjectDetail
              project={selected}
              onClose={() => setSelected(null)}
              onInstall={install}
              onUninstall={requestUninstall}
              onAuthor={(value) => {
                setAuthor(value);
                setView("browse");
                setSelected(null);
              }}
              onTag={(value) => {
                applyTag(value);
                setSelected(null);
              }}
              onProjectType={(value) => {
                setProjectType(value);
                setView("browse");
                setSelected(null);
              }}
              onLogin={login}
              installedWorldbook={selected ? (context?.registry?.[selected.id]?.worldbookName ?? null) : null}
              onError={setError}
              onSubscriptionChange={(projectId, subscribed) => {
                if (view === "subs") setSubscriptionOverrides((previous) => ({ ...previous, [projectId]: subscribed }));
              }}
              installState={selectedInstallState}
              loggedIn={Boolean(me)}
              installing={installing}
              connected={Boolean(context?.connected)}
              opener={detailOpener}
            />
          ) : null}
        </main>
      </div>
      <InstallDialog
        open={installTarget !== null}
        projectTitle={installTarget?.title ?? ""}
        primary={context?.worldbooks?.primary ?? null}
        additional={context?.worldbooks?.additional ?? []}
        available={context?.worldbooks?.available ?? []}
        busy={installing}
        onSelect={chooseInstallTarget}
        onClose={() => setInstallTarget(null)}
      />
      <ConfirmDialog
        open={uninstallTarget !== null}
        title="卸载此项目？"
        description={
          uninstallTarget
            ? `将从「${uninstallTarget.worldbookName}」中移除「${uninstallTarget.title}」的工坊条目。你修改过的条目会被保留，工坊订阅不受影响，之后可以重新安装。`
            : ""
        }
        confirmLabel="卸载"
        danger
        busy={installing}
        onConfirm={confirmUninstall}
        onCancel={() => setUninstallTarget(null)}
      >
        {uninstallTarget ? (
          <p>
            目标世界书：<strong>{uninstallTarget.worldbookName}</strong>
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
