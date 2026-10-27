import type { ReactNode, RefObject } from "react";
import { Component, lazy, Suspense } from "react";
import type { ProjectSummary } from "./api";
import { Button } from "./components/ui/button";
import { Installed } from "./features/installed/Installed";
import { Subscriptions } from "./features/projects/Subscriptions";
import type { useHostConnection } from "./useHostConnection";
import type { useInstalledProjects } from "./useInstalledProjects";
import type { useWorkshopNavigation } from "./useWorkshopNavigation";
import type { useWorkshopSession } from "./useWorkshopSession";

const CreateProject = lazy(() =>
  import("./features/projects/CreateProject").then((module) => ({ default: module.CreateProject })),
);
const MyProjects = lazy(() =>
  import("./features/projects/MyProjects").then((module) => ({ default: module.MyProjects })),
);
const AdminPanel = lazy(() =>
  import("./features/review/AdminPanel").then((module) => ({ default: module.AdminPanel })),
);
const AdminTools = lazy(() => import("./AdminTools").then((module) => ({ default: module.AdminTools })));

class DeferredView extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="panel" role="alert">
          <h2>{this.props.title}暂时无法显示</h2>
          <p className="hint">请检查网络连接后刷新页面重试，或通过侧栏返回其他页面。</p>
          <Button type="button" onClick={() => window.location.reload()}>
            刷新页面
          </Button>
        </section>
      );
    }
    return (
      <Suspense
        fallback={
          <section className="panel" role="status" aria-live="polite">
            正在加载{this.props.title}…
          </section>
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
export function WorkshopWorkspaces({
  view,
  me,
  setNewlyCreatedProjectId,
  setView,
  setError,
  setNotice,
  newlyCreatedProjectId,
  subscriptionOverrides,
  detailOpener,
  setSelected,
  reviewer,
  installedAvailable,
  installedItems,
  context,
  installedLoading,
  installedPending,
  embedded,
  scanning,
  updatingId,
  installing,
  rescanInstalls,
  reloadInstalledProjects,
  performInstall,
  requestUninstall,
  children,
}: {
  view: ReturnType<typeof useWorkshopNavigation>["view"];
  me: ReturnType<typeof useWorkshopSession>["me"];
  setNewlyCreatedProjectId: (id: string | null) => void;
  setView: ReturnType<typeof useWorkshopNavigation>["setView"];
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  newlyCreatedProjectId: string | null;
  subscriptionOverrides: Record<string, boolean>;
  detailOpener: RefObject<HTMLElement | null>;
  setSelected: (project: ProjectSummary | null) => void;
  reviewer: boolean;
  installedAvailable: boolean;
  installedItems: ReturnType<typeof useInstalledProjects>["installedItems"];
  context: ReturnType<typeof useHostConnection>["context"];
  installedLoading: ReturnType<typeof useInstalledProjects>["installedLoading"];
  installedPending: ReturnType<typeof useInstalledProjects>["installedPending"];
  embedded: boolean;
  scanning: ReturnType<typeof useHostConnection>["scanning"];
  updatingId: ReturnType<typeof useHostConnection>["updatingId"];
  installing: ReturnType<typeof useHostConnection>["installing"];
  rescanInstalls: ReturnType<typeof useHostConnection>["rescanInstalls"];
  reloadInstalledProjects: ReturnType<typeof useInstalledProjects>["reloadInstalledProjects"];
  performInstall: ReturnType<typeof useHostConnection>["performInstall"];
  requestUninstall: ReturnType<typeof useHostConnection>["requestUninstall"];
  children: ReactNode;
}) {
  return view === "create" && me ? (
    <DeferredView key="create" title="新建项目">
      <CreateProject
        onCreated={(projectId) => {
          setNewlyCreatedProjectId(projectId);
          setView("projects");
        }}
        onCancel={() => setView("projects")}
        onError={setError}
        onNotice={setNotice}
      />
    </DeferredView>
  ) : view === "projects" && me ? (
    <DeferredView key="projects" title="我的项目">
      <MyProjects
        initialSelectedId={newlyCreatedProjectId}
        onInitialSelectionConsumed={() => setNewlyCreatedProjectId(null)}
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
    </DeferredView>
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
    <DeferredView key="admin" title="审核面板">
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
    </DeferredView>
  ) : view === "tools" && me?.role === "owner" ? (
    <DeferredView key="tools" title="管理工具">
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
    </DeferredView>
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
    children
  );
}
