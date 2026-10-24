import {
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Compass,
  FolderKanban,
  LayoutGrid,
  List,
  LogIn,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { AdminTools } from "./AdminTools";
import { api, type HomeResponse, type MeResponse, type ProjectSummary, setSessionToken } from "./api";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
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
const DOWNLOAD_LEDGER_KEY = "cw_download_ledger";

function readDownloadLedger(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DOWNLOAD_LEDGER_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
const SIDEBAR_STORAGE_KEY = "cw_sidebar_collapsed";
const SIDEBAR_MOBILE_QUERY = "(max-width: 1023px)";

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
  registry: Record<string, { version: string; worldbookName: string; entryCount?: number }>;
  installStates?: Record<string, "clean" | "localChanged" | "scanIncomplete">;
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
  const [pageSize, setPageSize] = useState(24);
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
  const detailOpener = useRef<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [context, setContext] = useState<HostContext | null>(null);
  const [installing, setInstalling] = useState(false);
  const [downloaded, setDownloaded] = useState<Record<string, string>>(readDownloadLedger);
  const [loginFallback, setLoginFallback] = useState<string | null>(null);
  const [view, setView] = useState<"browse" | "projects" | "subs" | "admin" | "tools">("browse");
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
  function install(project: ProjectSummary): void {
    if (!context?.connected) {
      setError("没有检测到 SillyTavern 上下文，请从酒馆内打开。");
      return;
    }
    setInstalling(true);
    setNotice(null);
    void api
      .acquisitions(project.id)
      .then(async (payload) => {
        const files: { worldbook?: string; regex?: string } = {};
        for (const ticket of payload.tickets) {
          files[ticket.kind] = await api.downloadTicketText(ticket.url);
        }
        const target = context.worldbooks.primary ?? context.worldbooks.available[0] ?? null;
        postToHost({
          type: "cw:install",
          project: payload.project,
          files,
          targetWorldbook: target,
        });
      })
      .catch((reason) => {
        setError(String(reason));
        setInstalling(false);
      });
  }
  function uninstall(project: ProjectSummary): void {
    setInstalling(true);
    postToHost({ type: "cw:uninstall", projectId: project.id });
  }
  function download(project: ProjectSummary): void {
    setInstalling(true);
    void api
      .downloadTickets(project.id)
      .then(async (tickets) => {
        for (const file of tickets.files) {
          const blob = await api.downloadTicket(file.url);
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `${project.title}-${file.kind}.json`;
          link.click();
          URL.revokeObjectURL(url);
        }
        setDownloaded((previous) => {
          const next = { ...previous, [project.id]: project.publishedRevisionId ?? "unknown" };
          try {
            localStorage.setItem(DOWNLOAD_LEDGER_KEY, JSON.stringify(next));
          } catch {
            /* storage may be unavailable */
          }
          return next;
        });
        setNotice("下载已开始。");
      })
      .catch((reason) => setError(`下载失败：${String(reason)}`))
      .finally(() => setInstalling(false));
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
        setNotice(data.ok ? "安装完成。" : `安装失败：${String(data.message ?? "")}`);
        if (data.ok) postToHost({ type: "cw:request-context" });
      } else if (data.type === "cw:uninstall-result") {
        setInstalling(false);
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
  const reviewer = me?.role === "reviewer" || me?.role === "owner";
  return (
    <div className={`shell${embedded ? " embedded" : ""}`}>
      <header className="site-header" inert={isMobile && sidebarOpen}>
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
          <h1>
            创意工坊<span className="brand-latin">CreativeWorkshop</span>
          </h1>
        </div>
        <div className="header-tools">
          <div className="header-search">
            <Search aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索项目、作者、标签"
              aria-label="搜索"
            />
          </div>
          {me ? (
            <div className="account">
              <span>{me.globalName || me.username}</span>
              <Button type="button" size="sm" variant="ghost" onClick={logout}>
                退出
              </Button>
            </div>
          ) : (
            <Button type="button" className="login" onClick={login}>
              <LogIn aria-hidden="true" />
              Discord 登录
            </Button>
          )}
        </div>
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
          </nav>
          <section className="sidebar-filters" aria-labelledby="sidebar-filter-title">
            <div className="sidebar-filter-head">
              <span id="sidebar-filter-title" className="sidebar-section-label">
                筛选
              </span>
              {projectType || tag.trim() || author ? (
                <button
                  type="button"
                  className="sidebar-reset"
                  onClick={() => {
                    setProjectType("");
                    setTag("");
                    setAuthor(null);
                  }}
                >
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
          </section>
          {me ? (
            <nav className="sidebar-nav sidebar-account-nav" aria-label="个人空间">
              <span className="sidebar-section-label">个人</span>
              <button
                type="button"
                className={view === "projects" ? "active" : ""}
                onClick={() => {
                  setView("projects");
                  setSidebarOpen(false);
                }}
              >
                <FolderKanban aria-hidden="true" />
                我的项目
              </button>
              <button
                type="button"
                className={view === "subs" ? "active" : ""}
                onClick={() => {
                  setView("subs");
                  setSidebarOpen(false);
                }}
              >
                <CircleUserRound aria-hidden="true" />
                我的订阅
              </button>
              {reviewer ? (
                <button
                  type="button"
                  className={view === "admin" ? "active" : ""}
                  onClick={() => {
                    setView("admin");
                    setSidebarOpen(false);
                  }}
                >
                  <ShieldCheck aria-hidden="true" />
                  审核台
                </button>
              ) : null}
              {me.role === "owner" ? (
                <button
                  type="button"
                  className={view === "tools" ? "active" : ""}
                  onClick={() => {
                    setView("tools");
                    setSidebarOpen(false);
                  }}
                >
                  <SlidersHorizontal aria-hidden="true" />
                  管理
                </button>
              ) : null}
            </nav>
          ) : null}
        </div>
        <main className="workshop-main" inert={isMobile && sidebarOpen}>
          <nav className="mobile-nav" aria-label="主导航">
            <button
              type="button"
              aria-current={view === "browse" ? "page" : undefined}
              onClick={() => setView("browse")}
            >
              <Compass aria-hidden="true" />
              <span>工坊</span>
            </button>
            {me ? (
              <>
                <button
                  type="button"
                  aria-current={view === "projects" ? "page" : undefined}
                  onClick={() => setView("projects")}
                >
                  <FolderKanban aria-hidden="true" />
                  <span>我的项目</span>
                </button>
                <button
                  type="button"
                  aria-current={view === "subs" ? "page" : undefined}
                  onClick={() => setView("subs")}
                >
                  <CircleUserRound aria-hidden="true" />
                  <span>我的订阅</span>
                </button>
                {reviewer ? (
                  <button
                    type="button"
                    aria-current={view === "admin" ? "page" : undefined}
                    onClick={() => setView("admin")}
                  >
                    <ShieldCheck aria-hidden="true" />
                    <span>审核台</span>
                  </button>
                ) : null}
                {me.role === "owner" ? (
                  <button
                    type="button"
                    aria-current={view === "tools" ? "page" : undefined}
                    onClick={() => setView("tools")}
                  >
                    <SlidersHorizontal aria-hidden="true" />
                    <span>管理</span>
                  </button>
                ) : null}
              </>
            ) : (
              <button type="button" onClick={login}>
                <LogIn aria-hidden="true" />
                <span>登录</span>
              </button>
            )}
          </nav>
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
            <p className="notice" role="status">
              {notice}
            </p>
          ) : null}
          {view === "projects" && me ? (
            <MyProjects
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
          ) : (
            <>
              {" "}
              {!search.trim() && !projectType && !author && !tag.trim() ? (
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
                      ? "暂无项目"
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
              <nav className="pagination" aria-label="分页">
                <label>
                  每页
                  <select
                    aria-label="每页项目数"
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                  >
                    {[12, 24, 48].map((size) => (
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
              onUninstall={uninstall}
              onDownload={download}
              onAuthor={(value) => {
                setAuthor(value);
                setView("browse");
                setSelected(null);
              }}
              onError={setError}
              onSubscriptionChange={(projectId, subscribed) => {
                if (view === "subs") setSubscriptionOverrides((previous) => ({ ...previous, [projectId]: subscribed }));
              }}
              downloadedRevision={downloaded[selected.id] ?? null}
              installState={selectedInstallState}
              loggedIn={Boolean(me)}
              installing={installing}
              embedded={embedded}
              opener={detailOpener}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
