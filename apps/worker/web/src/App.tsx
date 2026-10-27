import { useEffect, useEffectEvent, useRef, useState } from "react";

import { api, type HomeResponse, type ProjectSummary } from "./api";

import { ConfirmDialog } from "./components/ui/confirm-dialog";

import { InstallDialog } from "./features/installed/InstallDialog";

import { ProjectDetail } from "./features/projects/ProjectDetail";

import { useCatalogue } from "./useCatalogue";
import { useHostConnection } from "./useHostConnection";
import { useInstalledProjects } from "./useInstalledProjects";
import { useWorkshopNavigation } from "./useWorkshopNavigation";
import { useWorkshopSession } from "./useWorkshopSession";
import { WorkshopCatalogue } from "./WorkshopCatalogue";
import { WorkshopHeader } from "./WorkshopHeader";
import { WorkshopMessages } from "./WorkshopMessages";
import { WorkshopSidebar } from "./WorkshopSidebar";
import { WorkshopWorkspaces } from "./WorkshopWorkspaces";
export function App() {
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [selected, setSelected] = useState<ProjectSummary | null>(null);
  const [newlyCreatedProjectId, setNewlyCreatedProjectId] = useState<string | null>(null);
  const detailOpener = useRef<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const embedded = new URLSearchParams(location.search).get("embed") === "1";
  const {
    view,
    setView,
    setSidebarOpen,
    headerRef,
    isMobile,
    sidebarOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    drawerToggle,
    drawerClose,
  } = useWorkshopNavigation();
  const {
    setTag,
    search,
    setSearch,
    projectType,
    tag,
    author,
    setProjectType,
    clearFilters,
    pageTags,
    setAuthor,
    sort,
    setSort,
    layout,
    setLayout,
    hasFilters,
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
  } = useCatalogue({ setError });
  const { me, logout, login, loginFallback, refreshMe } = useWorkshopSession({
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
    postToHost,
    installConflicts,
    setInstallConflicts,
    scanning,
    updatingId,
    installing,
    rescanInstalls,
    performInstall,
    requestUninstall,
    install,
    installTarget,
    chooseInstallTarget,
    setInstallTarget,
    uninstallTarget,
    confirmUninstall,
    setUninstallTarget,
  } = useHostConnection({ embedded, me, login, setError, setNotice });
  const { installedUpdateCount, installedItems, installedLoading, installedPending, reloadInstalledProjects } =
    useInstalledProjects(context);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const previousAvatar = useRef(me?.avatarUrl);
  useEffect(() => {
    if (previousAvatar.current !== me?.avatarUrl) {
      previousAvatar.current = me?.avatarUrl;
      setAvatarFailed(false);
    }
  }, [me?.avatarUrl]);
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
    api
      .home()
      .then(setHome)
      .catch((reason) => setError(String(reason)));
    refreshSession();
  }, []);
  const selectedInstallState = selected ? installationState(selected) : "notInstalled";

  function applyTag(value: string): void {
    setView("browse");
    setTag((current) => (current === value ? "" : value));
    setSidebarOpen(false);
  }
  const installedAvailable = embedded || Boolean(context?.connected);
  const reviewer = me?.role === "reviewer" || me?.role === "owner";
  return (
    <div className={`shell${embedded ? " embedded" : ""}${me ? " authenticated" : ""}`}>
      <WorkshopHeader
        headerRef={headerRef}
        isMobile={isMobile}
        sidebarOpen={sidebarOpen}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        search={search}
        setSearch={setSearch}
        setView={setView}
        connectionStatus={connectionStatus}
        connectionLabel={connectionLabel}
        connectionTitle={connectionTitle}
        embedded={embedded}
        postToHost={postToHost}
        me={me}
        avatarFailed={avatarFailed}
        setAvatarFailed={setAvatarFailed}
        logout={logout}
        login={login}
        drawerToggle={drawerToggle}
        setSidebarOpen={setSidebarOpen}
        projectType={projectType}
        tag={tag}
        author={author}
        view={view}
        reviewer={reviewer}
      />
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
        <WorkshopSidebar
          sidebarOpen={sidebarOpen}
          isMobile={isMobile}
          drawerClose={drawerClose}
          setSidebarOpen={setSidebarOpen}
          drawerToggle={drawerToggle}
          view={view}
          projectType={projectType}
          setView={setView}
          setProjectType={setProjectType}
          installedAvailable={installedAvailable}
          installedUpdateCount={installedUpdateCount}
          tag={tag}
          author={author}
          clearFilters={clearFilters}
          setTag={setTag}
          applyTag={applyTag}
          pageTags={pageTags}
          setAuthor={setAuthor}
          sort={sort}
          setSort={setSort}
          layout={layout}
          setLayout={setLayout}
        />
        <main className="workshop-main" inert={isMobile && sidebarOpen}>
          <WorkshopMessages
            home={home}
            view={view}
            error={error}
            setError={setError}
            loginFallback={loginFallback}
            notice={notice}
            setNotice={setNotice}
            installConflicts={installConflicts}
            setInstallConflicts={setInstallConflicts}
          />
          <WorkshopWorkspaces
            view={view}
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
            installedLoading={installedLoading}
            installedPending={installedPending}
            embedded={embedded}
            scanning={scanning}
            updatingId={updatingId}
            installing={installing}
            rescanInstalls={rescanInstalls}
            reloadInstalledProjects={reloadInstalledProjects}
            performInstall={performInstall}
            requestUninstall={requestUninstall}
          >
            <WorkshopCatalogue
              hasFilters={hasFilters}
              search={search}
              setSearch={setSearch}
              projectType={projectType}
              setProjectType={setProjectType}
              author={author}
              setAuthor={setAuthor}
              tag={tag}
              setTag={setTag}
              clearFilters={clearFilters}
              detailOpener={detailOpener}
              setSelected={setSelected}
              sort={sort}
              setSort={setSort}
              layout={layout}
              setLayout={setLayout}
              listLoading={listLoading}
              loadedQuery={loadedQuery}
              queryKey={queryKey}
              projects={projects}
              pageIndex={pageIndex}
              pageSize={pageSize}
              setListRetry={setListRetry}
              setPageSize={setPageSize}
              changePage={changePage}
              nextCursor={nextCursor}
            />
          </WorkshopWorkspaces>
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
