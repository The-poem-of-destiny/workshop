import { useRef, useState } from "react";
import { api, type MeResponse, type ProjectSummary } from "./api";
import type { HostContext } from "./useHostConnection";

type HostMutationOptions = {
  context: HostContext | null;
  me: MeResponse["user"] | null;
  login: () => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  postToHost: (payload: Record<string, unknown>) => void;
};
export function useHostMutations({ context, me, login, setError, setNotice, postToHost }: HostMutationOptions) {
  const [installing, setInstalling] = useState(false);
  const hostMutationPending = useRef(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<ProjectSummary | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<{ id: string; title: string; worldbookName: string } | null>(
    null,
  );
  const [installConflicts, setInstallConflicts] = useState<string[] | null>(null);
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
  return {
    setInstalling,
    hostMutationPending,
    setUpdatingId,
    setInstallConflicts,
    installConflicts,
    updatingId,
    installing,
    performInstall,
    requestUninstall,
    install,
    installTarget,
    chooseInstallTarget,
    setInstallTarget,
    uninstallTarget,
    confirmUninstall,
    setUninstallTarget,
  };
}
