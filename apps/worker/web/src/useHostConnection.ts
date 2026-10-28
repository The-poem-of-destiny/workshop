import type { InstallScan } from "@workshop/contracts";
import { useEffect, useState } from "react";
import type { MeResponse, ProjectSummary } from "./api";
import type { InstallState } from "./features/projects/ProjectDetail";
import { hostConnectionStatus } from "./hostConnectionStatus";
import { createInstallBridge, type InstallBridge, type InstallCompletion } from "./lib/install-bridge";
import { useHostMessages } from "./useHostMessages";
import { useHostMutations } from "./useHostMutations";

type Feedback = { setError: (message: string | null) => void; setNotice: (message: string | null) => void };
export interface HostContext {
  connected: boolean;
  characterName: string | null;
  worldbooks: { primary: string | null; additional: string[]; available: string[] };
  installationScan: InstallScan;
  clientVersion: string;
  error?: string;
}
type HostConnectionOptions = Feedback & { embedded: boolean; me: MeResponse["user"] | null; login: () => void };
export function useHostConnection({ embedded, me, login, setError, setNotice }: HostConnectionOptions) {
  const [context, setContext] = useState<HostContext | null>(null);
  const [scanning, setScanning] = useState(false);
  const [bridge, setBridge] = useState<InstallBridge | null>(null);
  const [hostOrigin] = useState(() => {
    try {
      const url = new URL(document.referrer || new URLSearchParams(location.search).get("hostOrigin") || "");
      return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
    } catch {
      return null;
    }
  });
  function postToHost(payload: Record<string, unknown>): void {
    if (window.parent !== window && hostOrigin) window.parent.postMessage(payload, hostOrigin);
  }
  function updateInstallationScan(result: InstallCompletion): void {
    setContext((previous) => (previous ? { ...previous, installationScan: result.scan } : previous));
  }
  const mutations = useHostMutations({
    context,
    bridge,
    me,
    login,
    setError,
    setNotice,
    postToHost,
    onCompleted: updateInstallationScan,
  });
  async function rescanInstalls(): Promise<void> {
    if (!bridge || scanning) return;
    setScanning(true);
    setError(null);
    try {
      const scan = await bridge.scan();
      setContext((previous) => (previous ? { ...previous, installationScan: scan } : previous));
    } catch (reason) {
      setError(`重新扫描失败：${String(reason)}`);
    } finally {
      setScanning(false);
    }
  }
  useEffect(() => {
    if (!hostOrigin || window.parent === window) return;
    const connection = createInstallBridge({ origin: hostOrigin, source: window.parent });
    setBridge(connection);
    return () => {
      connection.dispose();
      setBridge(null);
    };
  }, [hostOrigin]);
  useHostMessages({ postToHost, embedded, hostOrigin, setContext });
  function installationState(project: ProjectSummary): InstallState {
    const instances =
      context?.installationScan?.instances.filter((instance) => instance.projectId === project.id) ?? [];
    if (!instances.length) return "notInstalled";
    if (instances.some((instance) => project.publishedRevisionId && instance.version !== project.publishedRevisionId))
      return "updateAvailable";
    if (instances.some((instance) => instance.state === "localChanged")) return "localChanged";
    if (
      instances.some((instance) => instance.state === "baselineUnknown") ||
      context?.installationScan?.failures.length
    )
      return "scanIncomplete";
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
    bridge,
    scanning,
    rescanInstalls,
    ...mutations,
  };
}
