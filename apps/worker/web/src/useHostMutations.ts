import type { InstallIntent } from "@workshop/contracts";
import { useRef, useState } from "react";
import { api, type MeResponse, type ProjectSummary } from "./api";
import type { InstalledItem } from "./features/installed/Installed";
import type { InstallBridge, InstallCompletion } from "./lib/install-bridge";
import type { HostContext } from "./useHostConnection";

type HostMutationOptions = {
  context: HostContext | null;
  bridge: InstallBridge | null;
  me: MeResponse["user"] | null;
  login: () => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  postToHost: (payload: Record<string, unknown>) => void;
  onCompleted: (result: InstallCompletion) => void;
};
export function useHostMutations({
  context,
  bridge,
  me,
  login,
  setError,
  setNotice,
  postToHost,
  onCompleted,
}: HostMutationOptions) {
  const [installing, setInstalling] = useState(false);
  const hostMutationPending = useRef(false);
  const [installTarget, setInstallTarget] = useState<{ title: string; intent: InstallIntent } | null>(null);
  const [instanceChoice, setInstanceChoice] = useState<{
    project: ProjectSummary;
    action: "install" | "uninstall";
  } | null>(null);
  async function prepareInstall(
    project: ProjectSummary,
    action: "install" | "update" = "install",
    instanceId?: string,
  ): Promise<void> {
    if (hostMutationPending.current || installTarget) return;
    if (!context?.connected || !bridge) {
      setError("没有可信的 SillyTavern 连接，请从酒馆内重新打开。");
      return;
    }
    if (!me) {
      login();
      return;
    }
    hostMutationPending.current = true;
    setInstalling(true);
    setError(null);
    try {
      const payload = await api.acquisitions(project.id);
      const files: { worldbook?: string; regex?: string } = {};
      for (const ticket of payload.tickets) files[ticket.kind] = await api.downloadTicketText(ticket.url);
      setInstanceChoice(null);
      setInstallTarget({ title: project.title, intent: { action, instanceId, project: payload.project, files } });
    } catch (reason) {
      setError(String(reason));
    } finally {
      hostMutationPending.current = false;
      setInstalling(false);
    }
  }
  function install(project: ProjectSummary): void {
    if (hostMutationPending.current || installTarget) return;
    if (!context?.connected || !bridge) {
      setError("没有可信的 SillyTavern 连接，请从酒馆内重新打开。");
      return;
    }
    if (!me) {
      login();
      return;
    }
    if (context.installationScan?.instances.some((instance) => instance.projectId === project.id)) {
      setInstanceChoice({ project, action: "install" });
    } else void prepareInstall(project);
  }
  function requestUninstall(project: ProjectSummary): void {
    if (hostMutationPending.current || installTarget) return;
    setInstanceChoice({ project, action: "uninstall" });
  }
  function instanceOperation(item: InstalledItem, action: "uninstall" | "migrate"): void {
    if (!bridge || hostMutationPending.current || installTarget) return;
    setInstanceChoice(null);
    setInstallTarget({
      title: item.project?.title ?? item.instance.projectId,
      intent: { action, instanceId: item.instance.instanceId },
    });
  }
  function completeInstall(result: InstallCompletion): void {
    onCompleted(result);
    setInstallTarget(null);
    setNotice("实例操作完成。");
    postToHost({ type: "cw:request-context" });
  }
  return {
    installing,
    installTarget,
    setInstallTarget,
    instanceChoice,
    setInstanceChoice,
    prepareInstall,
    install,
    requestUninstall,
    instanceOperation,
    completeInstall,
  };
}
