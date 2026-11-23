import type { InstallIntent } from "@workshop/contracts";
import { useEffect, useRef, useState } from "react";
import { api, formatUserError, type MeResponse, type ProjectSummary } from "../../api";
import type { InstallBridge, InstallCompletion } from "../../lib/install-bridge";
import type { InstalledItem } from "./Installed";

type HostMutationOptions = {
  getInstallBlock: () => string | null;
  bridge: InstallBridge | null;
  me: MeResponse["user"] | null;
  login: () => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  postToHost: (payload: Record<string, unknown>) => void;
  onCompleted: (result: InstallCompletion) => void;
};
export function useHostMutations({
  getInstallBlock,
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
  const currentUser = useRef(me);
  currentUser.current = me;
  const [installTarget, setInstallTarget] = useState<{ title: string; intent: InstallIntent } | null>(null);
  const [instanceChoice, setInstanceChoice] = useState<{
    project: ProjectSummary;
    action: "update" | "uninstall";
  } | null>(null);
  useEffect(() => {
    if (!me) {
      setInstallTarget(null);
      setInstanceChoice(null);
    }
  }, [me]);
  function operationUser(): MeResponse["user"] | null {
    if (hostMutationPending.current || installTarget) return null;
    const blocked = getInstallBlock();
    if (blocked || !bridge) {
      setError(blocked ?? "没有可信的 SillyTavern 连接，请从酒馆内重新打开。");
      return null;
    }
    if (!me) login();
    return me;
  }
  async function prepareInstall(
    project: ProjectSummary,
    action: "install" | "update" = "install",
    instanceId?: string,
  ): Promise<void> {
    const user = operationUser();
    if (!user) return;
    hostMutationPending.current = true;
    setInstalling(true);
    setError(null);
    try {
      const payload = await api.acquisitions(project.id);
      const files: { worldbook?: string; regex?: string } = {};
      for (const file of payload.downloads) files[file.kind] = await api.downloadText(file.url);
      if (currentUser.current?.id !== user.id) return;
      const blocked = getInstallBlock();
      if (blocked) {
        setError(blocked);
        return;
      }
      setInstanceChoice(null);
      setInstallTarget({
        title: project.title,
        intent: {
          action,
          instanceId,
          project: {
            ...payload.project,
            description: project.publishedVersionId === payload.project.version ? (project.description ?? null) : null,
            author: { id: project.author.id, name: project.author.name },
            versionLabel:
              project.publishedVersionId === payload.project.version ? (project.versionLabel ?? null) : null,
          },
          files,
        },
      });
    } catch (reason) {
      setError(formatUserError(reason));
    } finally {
      hostMutationPending.current = false;
      setInstalling(false);
    }
  }
  function install(project: ProjectSummary): void {
    void prepareInstall(project);
  }
  function requestUpdate(project: ProjectSummary): void {
    if (!operationUser()) return;
    setInstanceChoice({ project, action: "update" });
  }
  function requestUninstall(project: ProjectSummary): void {
    if (!operationUser()) return;
    setInstanceChoice({ project, action: "uninstall" });
  }
  function instanceOperation(item: InstalledItem, action: "uninstall" | "migrate"): void {
    if (!operationUser()) return;
    setInstanceChoice(null);
    setInstallTarget({
      title: item.project?.title ?? "本地已装项目",
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
    requestUpdate,
    requestUninstall,
    instanceOperation,
    completeInstall,
  };
}
