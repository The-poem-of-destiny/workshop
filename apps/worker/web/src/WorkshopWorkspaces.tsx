import type { ReactNode, RefObject } from "react";
import { AdminTools } from "./AdminTools";
import type { ProjectSummary } from "./api";
import { Installed } from "./features/installed/Installed";
import { CreateProject } from "./features/projects/CreateProject";
import { MyProjects } from "./features/projects/MyProjects";
import { Subscriptions } from "./features/projects/Subscriptions";
import { AdminPanel } from "./features/review/AdminPanel";
import type { useHostConnection } from "./useHostConnection";
import type { useInstalledProjects } from "./useInstalledProjects";
import type { useWorkshopNavigation } from "./useWorkshopNavigation";
import type { useWorkshopSession } from "./useWorkshopSession";

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
    children
  );
}
