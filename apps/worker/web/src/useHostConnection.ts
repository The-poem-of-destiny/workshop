import { useState } from "react";
import type { MeResponse, ProjectSummary } from "./api";
import type { InstalledRecord, InstalledScanState } from "./features/installed/Installed";
import type { InstallState } from "./features/projects/ProjectDetail";
import { hostConnectionStatus } from "./hostConnectionStatus";
import { useHostMessages } from "./useHostMessages";
import { useHostMutations } from "./useHostMutations";

type Feedback = { setError: (message: string | null) => void; setNotice: (message: string | null) => void };
export interface HostContext {
  connected: boolean;
  characterName: string | null;
  worldbooks: { primary: string | null; additional: string[]; available: string[] };
  registry: Record<string, InstalledRecord>;
  installStates?: Record<string, InstalledScanState>;
  clientVersion: string;
  error?: string;
}
type HostConnectionOptions = Feedback & { embedded: boolean; me: MeResponse["user"] | null; login: () => void };
export function useHostConnection({ embedded, me, login, setError, setNotice }: HostConnectionOptions) {
  const [context, setContext] = useState<HostContext | null>(null);
  const [scanning, setScanning] = useState(false);
  function postToHost(payload: Record<string, unknown>): void {
    if (window.parent !== window) window.parent.postMessage(payload, "*");
  }
  const {
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
  } = useHostMutations({ context, me, login, setError, setNotice, postToHost });
  function rescanInstalls(): void {
    setScanning(true);
    setError(null);
    postToHost({ type: "cw:scan" });
  }
  useHostMessages({
    postToHost,
    embedded,
    setContext,
    setInstalling,
    hostMutationPending,
    setUpdatingId,
    setNotice,
    setInstallConflicts,
    setScanning,
    setError,
  });
  function installationState(project: ProjectSummary): InstallState {
    const record = context?.registry?.[project.id];
    if (!record) return "notInstalled";
    if (project.publishedRevisionId && record.version !== project.publishedRevisionId) return "updateAvailable";
    const scan = context?.installStates?.[project.id];
    if (scan === "localChanged") return "localChanged";
    if (scan === "scanIncomplete" || !scan) return "scanIncomplete";
    return "upToDate";
  }
  const { connectionStatus, connectionLabel, connectionTitle } = hostConnectionStatus(context, embedded);
  return {
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
  };
}
