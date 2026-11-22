import { useEffect, useEffectEvent, useRef, useState } from "react";

import { ApiError, type ProjectSummary } from "./api";
import { InstallDialog } from "./features/installed/InstallDialog";
import { DiscordLinkPrompt, type DiscordPromptTarget } from "./features/policy/DiscordLinkPrompt";
import { PolicyGateDialog } from "./features/policy/PolicyGateDialog";
import { WorkshopFaqDialog } from "./features/policy/WorkshopFaqDialog";
import { Discovery } from "./features/projects/Discovery";
import { ProjectDetail } from "./features/projects/ProjectDetail";
import { InstallInstanceChoice } from "./InstallInstanceChoice";
import { parseSiteContent } from "./lib/siteContent";

import { useCatalogue } from "./useCatalogue";
import { useHostConnection } from "./useHostConnection";
import { useInstalledProjects } from "./useInstalledProjects";
import { useWorkshopHome } from "./useWorkshopHome";
import { useWorkshopNavigation } from "./useWorkshopNavigation";
import { useWorkshopSession } from "./useWorkshopSession";
import { WorkshopCatalogue } from "./WorkshopCatalogue";
import { WorkshopHeader } from "./WorkshopHeader";
import { WorkshopMessages } from "./WorkshopMessages";
import { WorkshopSidebar } from "./WorkshopSidebar";
import { WorkshopWorkspaces } from "./WorkshopWorkspaces";

function StatusNotice({
  title,
  body,
  detail,
  reset,
}: {
  title: string;
  body: string;
  detail?: string | null;
  reset?: boolean;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!reset) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [reset]);
  const hms = reset ? new Date(864e5 - (Date.now() % 864e5)).toISOString().slice(11, 19).split(":") : null;
  return (
    <main role="status">
      <h1>{title}</h1>
      <p>{body}</p>
      {hms && <p>{`距离下次额度刷新还有 ${hms[0]} 小时 ${hms[1]} 分 ${hms[2]} 秒（北京时间 08:00）`}</p>}
      {detail && (
        <details>
          <summary>错误详情</summary>
          <code>{detail}</code>
        </details>
      )}
    </main>
  );
}

function useAvatarFailure(avatarUrl: string | null | undefined) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const previousAvatar = useRef(avatarUrl);
  useEffect(() => {
    if (previousAvatar.current !== avatarUrl) {
      previousAvatar.current = avatarUrl;
      setAvatarFailed(false);
    }
  }, [avatarUrl]);
  return [avatarFailed, setAvatarFailed] as const;
}

export function App() {
  const home = useWorkshopHome();
  const site = home.status === "ready" && home.data.site.ok ? home.data.site.data : null;
  const { communityInviteUrl } = parseSiteContent(site);
  const [selected, setSelected] = useState<ProjectSummary | null>(null);
  const [newlyCreatedProjectId, setNewlyCreatedProjectId] = useState<string | null>(null);
  const [faqOpen, setFaqOpen] = useState(false);
  const [discordPrompt, setDiscordPrompt] = useState<DiscordPromptTarget | null>(null);
  const detailOpener = useRef<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const embedded = new URLSearchParams(location.search).get("embed") === "1";
  const nav = useWorkshopNavigation();
  const {
    view,
    onDirtyChange,
    confirmLeave,
    setView,
    setSidebarOpen,
    isMobile,
    sidebarOpen,
    sidebarCollapsed,
    drawerToggle,
  } = nav;
  const catalogue = useCatalogue({ enabled: view === "browse", setError, home });
  const { addTags, setProjectTypes, setAuthor, setCollection, hasFilters } = catalogue;
  const {
    me,
    pendingPolicyUser,
    policyState,
    policyDialogOpen,
    setPolicyDialogOpen,
    completePolicy,
    authInviteHint,
    clearAuthInviteHint,
    logout,
    login,
    loginFallback,
    refreshMe,
    sessionError,
  } = useWorkshopSession({
    embedded,
    setError,
    setNotice,
    setView,
  });
  const {
    installationState,
    context,
    connectionStatus,
    connectionLabel,
    connectionTitle,
    installBlock,
    postToHost,
    bridge,
    scanning,
    converting,
    convertLegacy,
    installing,
    rescanInstalls,
    prepareInstall,
    requestUninstall,
    requestUpdate,
    install,
    installTarget,
    setInstallTarget,
    instanceChoice,
    setInstanceChoice,
    instanceOperation,
    completeInstall,
  } = useHostConnection({ embedded, me, login, setError, setNotice });
  const { installedUpdateCount, installedItems, installedLoading, installedPending, reloadInstalledProjects } =
    useInstalledProjects(context, view === "installed");
  const [avatarFailed, setAvatarFailed] = useAvatarFailure(me?.avatarUrl);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [subscriptionOverrides, setSubscriptionOverrides] = useState<Record<string, boolean>>({});
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current !== view) {
      previousView.current = view;
      setSubscriptionOverrides({});
    }
  }, [view]);
  const refreshSession = useEffectEvent(() => void refreshMe());
  useEffect(() => {
    if (home.status === "error")
      setError(home.error instanceof Error ? home.error.message : "服务暂时繁忙，请稍后刷新页面再试。");
    else if (home.status === "ready" && !home.data.site.ok) setError(home.data.site.error.message);
  }, [home]);
  useEffect(() => {
    refreshSession();
  }, []);
  const selectedInstallState = selected ? installationState(selected) : "notInstalled";

  const installedAvailable = embedded || Boolean(context?.connected);
  const reviewer = me?.role === "reviewer" || me?.role === "owner";
  const showDesktopSidebar = view === "browse";
  const browseWith = (apply: () => void): void => {
    if (!setView("browse")) return;
    apply();
    setSelected(null);
  };

  const errorDetail =
    home.status === "error" && home.error instanceof ApiError && typeof home.error.details === "string"
      ? home.error.details
      : null;

  if (home.status === "error" && home.error instanceof ApiError && home.error.status === 503) {
    if (home.error.code === "maintenance") {
      return <StatusNotice title="工坊维护中" body="请稍后刷新页面再试。" />;
    }
    if (home.error.code === "quota_exceeded" && !installedAvailable) {
      return <StatusNotice title="今日云端额度已用完" body={home.error.message} detail={errorDetail} reset />;
    }
  }

  return (
    <div className={`shell${embedded ? " embedded" : ""}${me ? " authenticated" : ""}`}>
      <WorkshopHeader
        {...nav}
        {...catalogue}
        connectionStatus={connectionStatus}
        connectionLabel={connectionLabel}
        connectionTitle={connectionTitle}
        embedded={embedded}
        postToHost={postToHost}
        me={me}
        pendingPolicyUser={pendingPolicyUser}
        onOpenPolicy={() => setPolicyDialogOpen(true)}
        onOpenFaq={() => setFaqOpen(true)}
        avatarFailed={avatarFailed}
        setAvatarFailed={setAvatarFailed}
        logout={() => {
          if (confirmLeave()) logout();
        }}
        login={login}
        reviewer={reviewer}
      />

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

      <div className="page-stage" inert={isMobile && sidebarOpen}>
        <WorkshopMessages
          site={site}
          view={view}
          error={error}
          errorDetail={errorDetail}
          setError={setError}
          authInviteHint={authInviteHint}
          clearAuthInviteHint={clearAuthInviteHint}
          pendingPolicyUser={pendingPolicyUser}
          onOpenPolicy={() => setPolicyDialogOpen(true)}
          sessionError={sessionError}
          retrySession={() => void refreshMe()}
          loginFallback={loginFallback}
          notice={notice}
          setNotice={setNotice}
        />

        {view === "browse" && !hasFilters ? (
          <div className="discovery-stage">
            <Discovery
              home={home}
              onOpen={(project, opener) => {
                detailOpener.current = opener;
                setSelected(project);
              }}
            />
          </div>
        ) : null}
      </div>

      <div className={`shell-body${sidebarCollapsed || !showDesktopSidebar ? " sidebar-collapsed" : ""}`}>
        {showDesktopSidebar || isMobile ? (
          <WorkshopSidebar
            {...nav}
            {...catalogue}
            installedAvailable={installedAvailable}
            installedUpdateCount={installedUpdateCount}
          />
        ) : null}

        <main className="workshop-main" inert={isMobile && sidebarOpen}>
          <WorkshopWorkspaces
            view={view}
            onDirtyChange={onDirtyChange}
            me={me}
            setNewlyCreatedProjectId={setNewlyCreatedProjectId}
            setView={setView}
            setError={setError}
            setNotice={setNotice}
            newlyCreatedProjectId={newlyCreatedProjectId}
            subscriptionOverrides={subscriptionOverrides}
            detailOpener={detailOpener}
            setSelected={setSelected}
            reviewer={reviewer}
            installedAvailable={installedAvailable}
            installedItems={installedItems}
            context={context}
            installBlock={installBlock}
            installedLoading={installedLoading}
            installedPending={installedPending}
            embedded={embedded}
            scanning={scanning}
            converting={converting}
            convertLegacy={convertLegacy}
            installing={installing || installTarget !== null || converting}
            rescanInstalls={rescanInstalls}
            reloadInstalledProjects={reloadInstalledProjects}
            prepareInstall={prepareInstall}
            instanceOperation={instanceOperation}
          >
            <WorkshopCatalogue
              catalogue={catalogue}
              detailOpener={detailOpener}
              setSelected={setSelected}
              onDiscordPrompt={setDiscordPrompt}
            />
          </WorkshopWorkspaces>

          {selected ? (
            <ProjectDetail
              key={`${selected.id}:${me?.id ?? "anonymous"}:${me?.role ?? ""}`}
              project={selected}
              onClose={() => {
                if (!discordPrompt) setSelected(null);
              }}
              onInstall={install}
              onUpdate={requestUpdate}
              onUninstall={requestUninstall}
              onAuthor={(value) => browseWith(() => setAuthor(value))}
              onCollection={(value) => browseWith(() => setCollection(value))}
              onDiscordPrompt={setDiscordPrompt}
              onTag={(value) => browseWith(() => addTags([value]))}
              onProjectType={(value) => browseWith(() => setProjectTypes([value]))}
              onLogin={login}
              installedWorldbook={
                context?.installationScan?.instances
                  .filter((instance) => instance.projectId === selected.id)
                  .map((instance) => instance.location.worldbook ?? "角色正则")
                  .join("、") || null
              }
              onError={setError}
              onSubscriptionChange={(projectId, subscribed) => {
                if (view === "subs") setSubscriptionOverrides((previous) => ({ ...previous, [projectId]: subscribed }));
              }}
              installState={selectedInstallState}
              loggedIn={Boolean(me)}
              installing={installing || installTarget !== null}
              installBlock={installBlock}
              opener={detailOpener}
            />
          ) : null}
        </main>
      </div>

      <PolicyGateDialog
        open={policyDialogOpen}
        onOpenChange={setPolicyDialogOpen}
        pendingUser={pendingPolicyUser}
        policyState={policyState}
        onCompleted={completePolicy}
        onLogout={logout}
      />
      <DiscordLinkPrompt
        target={discordPrompt}
        communityInviteUrl={communityInviteUrl}
        onClose={() => setDiscordPrompt(null)}
      />
      <WorkshopFaqDialog
        open={faqOpen}
        onOpenChange={setFaqOpen}
        communityInviteUrl={communityInviteUrl}
        onOpenPolicy={() => setPolicyDialogOpen(true)}
      />
      {me && installTarget && bridge ? (
        <InstallDialog
          open
          projectTitle={installTarget.title}
          intent={installTarget.intent}
          scan={context?.installationScan ?? null}
          bridge={bridge}
          installBlock={installBlock}
          primary={context?.worldbooks?.primary ?? null}
          onCompleted={completeInstall}
          onClose={() => setInstallTarget(null)}
        />
      ) : null}
      <InstallInstanceChoice
        instanceChoice={me ? instanceChoice : null}
        setInstanceChoice={setInstanceChoice}
        installing={installing}
        installBlock={installBlock}
        prepareInstall={prepareInstall}
        instanceOperation={instanceOperation}
        installedItems={installedItems}
      />
    </div>
  );
}
