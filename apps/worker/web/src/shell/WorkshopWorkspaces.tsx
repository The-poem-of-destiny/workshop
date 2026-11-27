import type { ReactNode, RefObject } from "react";
import { Component, lazy, Suspense } from "react";
import { api, formatUserError, type ProjectSummary } from "../api";
import { Button } from "../components/ui/button";
import type { InstalledItem } from "../features/installed/Installed";
import { Installed } from "../features/installed/Installed";
import type { useHostConnection } from "../features/installed/useHostConnection";
import type { useInstalledProjects } from "../features/installed/useInstalledProjects";
import { Subscriptions } from "../features/projects/Subscriptions";
import type { useWorkshopNavigation } from "./useWorkshopNavigation";
import type { useWorkshopSession } from "./useWorkshopSession";

const CreateProject = lazy(() =>
  import("../features/projects/CreateProject").then((module) => ({ default: module.CreateProject })),
);
const MyProjects = lazy(() =>
  import("../features/projects/MyProjects").then((module) => ({ default: module.MyProjects })),
);
const ReviewWorkbench = lazy(() =>
  import("../features/review/ReviewWorkbench").then((module) => ({ default: module.ReviewWorkbench })),
);
const AdminTools = lazy(() =>
  import("../features/admin/AdminTools").then((module) => ({ default: module.AdminTools })),
);

class DeferredView extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
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
  onDirtyChange,
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
  installBlock,
  installedLoading,
  installedPending,
  embedded,
  scanning,
  converting,
  convertLegacy,
  installing,
  rescanInstalls,
  reloadInstalledProjects,
  prepareInstall,
  instanceOperation,
  children,
}: {
  view: ReturnType<typeof useWorkshopNavigation>["view"];
  onDirtyChange: (dirty: boolean) => void;
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
  installBlock: string | null;
  installedLoading: ReturnType<typeof useInstalledProjects>["installedLoading"];
  installedPending: ReturnType<typeof useInstalledProjects>["installedPending"];
  embedded: boolean;
  scanning: ReturnType<typeof useHostConnection>["scanning"];
  converting: boolean;
  convertLegacy: (worldbooks: string[]) => Promise<void>;
  installing: ReturnType<typeof useHostConnection>["installing"];
  rescanInstalls: ReturnType<typeof useHostConnection>["rescanInstalls"];
  reloadInstalledProjects: ReturnType<typeof useInstalledProjects>["reloadInstalledProjects"];
  prepareInstall: (project: ProjectSummary, action?: "install" | "update", instanceId?: string) => Promise<void>;
  instanceOperation: (item: InstalledItem, action: "uninstall" | "migrate") => void;
  children: ReactNode;
}) {
  return view === "create" && me ? (
    <DeferredView key="create" title="新建项目">
      <CreateProject
        onDirtyChange={onDirtyChange}
        onCreated={(projectId) => {
          onDirtyChange(false);
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
        onDirtyChange={onDirtyChange}
        initialSelectedId={newlyCreatedProjectId}
        onInitialSelectionConsumed={() => setNewlyCreatedProjectId(null)}
        onCreate={() => setView("create")}
        onPreview={(project, opener) => {
          detailOpener.current = opener;
          setSelected(project);
        }}
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
      <ReviewWorkbench
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
        onOpenProject={(projectId) => {
          void api
            .project(projectId)
            .then((detail) => {
              detailOpener.current = null;
              setSelected(detail);
            })
            .catch((reason) => setError(formatUserError(reason)));
        }}
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
      scan={context?.installationScan ?? null}
      installBlock={installBlock}
      error={
        context?.error
          ? /[\u4e00-\u9fff]/.test(context.error)
            ? context.error
            : "无法连接 SillyTavern，请确认酒馆内的工坊脚本正在运行并重新打开工坊。"
          : null
      }
      loading={installedLoading || installedPending || (embedded && context === null)}
      scanning={scanning}
      converting={converting}
      onConvertLegacy={convertLegacy}
      mutating={installing}
      onScan={rescanInstalls}
      onRetry={() => {
        reloadInstalledProjects();
        void rescanInstalls();
      }}
      onOpen={(item) => {
        if (!item.project) return;
        detailOpener.current = null;
        setSelected(item.project);
      }}
      onUpdate={(item) => {
        if (!item.project) return;
        void prepareInstall(item.project, "update", item.instance.instanceId);
      }}
      onUninstall={(item) => instanceOperation(item, "uninstall")}
      onMigrate={(item) => instanceOperation(item, "migrate")}
      onReinstall={() => setView("browse")}
    />
  ) : (
    children
  );
}
