import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { ProjectSummary } from "./api";
import { InstallDialog } from "./features/installed/InstallDialog";
import { ProjectDetail } from "./features/projects/ProjectDetail";
import { InstallInstanceChoice } from "./InstallInstanceChoice";

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
export function App() {
  const home = useWorkshopHome();
  const site = home.status === "ready" && home.data.site.ok ? home.data.site.data : null;
  const [selected, setSelected] = useState<ProjectSummary | null>(null);
  const [newlyCreatedProjectId, setNewlyCreatedProjectId] = useState<string | null>(null);
  const detailOpener = useRef<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const embedded = new URLSearchParams(location.search).get("embed") === "1";
  const {
    view,
    onDirtyChange,
    confirmLeave,
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
  const catalogue = useCatalogue({ enabled: view === "browse", setError, home });
  const {
    addTags,
    toggleTag,
    removeTag,
    tagLimitMessage,
    search,
    setSearch,
    projectTypes,
    setProjectTypes,
    includeContained,
    setIncludeContained,
    tags,
    author,
    clearFilters,
    pageTags,
    setAuthor,
    sort,
    setSort,
    layout,
    setLayout,
    hasFilters,
  } = catalogue;
  const { me, logout, login, loginFallback, refreshMe, sessionError } = useWorkshopSession({
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
    if (home.status === "error") setError(String(home.error));
    else if (home.status === "ready" && !home.data.site.ok) setError(home.data.site.error.message);
  }, [home]);
  useEffect(() => {
    refreshSession();
  }, []);
  const selectedInstallState = selected ? installationState(selected) : "notInstalled";

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
        confirmLeave={confirmLeave}
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
        logout={() => {
          if (confirmLeave()) logout();
        }}
        login={login}
        drawerToggle={drawerToggle}
        setSidebarOpen={setSidebarOpen}
        hasFilters={hasFilters}
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
          projectTypes={projectTypes}
          setView={setView}
          setProjectTypes={setProjectTypes}
          includeContained={includeContained}
          setIncludeContained={setIncludeContained}
          installedAvailable={installedAvailable}
          installedUpdateCount={installedUpdateCount}
          tags={tags}
          tagLimitMessage={tagLimitMessage}
          author={author}
          hasFilters={hasFilters}
          clearFilters={clearFilters}
          addTags={addTags}
          toggleTag={toggleTag}
          removeTag={removeTag}
          pageTags={pageTags}
          setAuthor={setAuthor}
          sort={sort}
          setSort={setSort}
          layout={layout}
          setLayout={setLayout}
        />
        <main className="workshop-main" inert={isMobile && sidebarOpen}>
          <WorkshopMessages
            site={site}
            view={view}
            error={error}
            setError={setError}
            sessionError={sessionError}
            retrySession={() => void refreshMe()}
            loginFallback={loginFallback}
            notice={notice}
            setNotice={setNotice}
          />
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
              home={home}
              catalogue={catalogue}
              detailOpener={detailOpener}
              setSelected={setSelected}
            />
          </WorkshopWorkspaces>
          {selected ? (
            <ProjectDetail
              key={`${selected.id}:${me?.id ?? "anonymous"}:${me?.role ?? ""}`}
              project={selected}
              onClose={() => setSelected(null)}
              onInstall={install}
              onUpdate={requestUpdate}
              onUninstall={requestUninstall}
              onAuthor={(value) => {
                if (!setView("browse")) return;
                setAuthor(value);
                setSelected(null);
              }}
              onTag={(value) => {
                if (!setView("browse")) return;
                addTags([value]);
                setSelected(null);
              }}
              onProjectType={(value) => {
                if (!setView("browse")) return;
                setProjectTypes([value]);
                setSelected(null);
              }}
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
              connected={Boolean(context?.connected)}
              opener={detailOpener}
            />
          ) : null}
        </main>
      </div>
      {me && installTarget && bridge ? (
        <InstallDialog
          open
          projectTitle={installTarget.title}
          intent={installTarget.intent}
          scan={context?.installationScan ?? null}
          bridge={bridge}
          primary={context?.worldbooks?.primary ?? null}
          onCompleted={completeInstall}
          onClose={() => setInstallTarget(null)}
        />
      ) : null}
      <InstallInstanceChoice
        instanceChoice={me ? instanceChoice : null}
        setInstanceChoice={setInstanceChoice}
        installing={installing}
        prepareInstall={prepareInstall}
        instanceOperation={instanceOperation}
        installedItems={installedItems}
      />
    </div>
  );
}
