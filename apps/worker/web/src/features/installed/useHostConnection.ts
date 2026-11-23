import type { InstallScan } from "@workshop/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUserError, type MeResponse, type ProjectSummary } from "../../api";
import { createInstallBridge, type InstallBridge, type InstallCompletion } from "../../lib/install-bridge";
import type { InstallState } from "../projects/ProjectDetail";
import { hostConnectionStatus, installBlockReason } from "./hostConnectionStatus";
import { useHostMessages } from "./useHostMessages";
import { useHostMutations } from "./useHostMutations";

const MISSING_HOST_ORIGIN_ERROR = "未能识别 SillyTavern 宿主来源，请更新工坊脚本或检查反向代理 Referrer-Policy 设置。";
const HANDSHAKE_TIMEOUT_ERROR = "连接 SillyTavern 超时，请确认酒馆内的工坊脚本正在运行，并从酒馆重新打开工坊。";

type Feedback = { setError: (message: string | null) => void; setNotice: (message: string | null) => void };
export interface HostContext {
  connected: boolean;
  characterName?: string | null;
  worldbooks?: { primary: string | null; additional: string[]; available: string[] } | null;
  installationScan?: InstallScan | null;
  clientVersion?: string;
  installCompatibility?: {
    state: "compatible" | "version_mismatch" | "channel_unavailable" | "unverified";
    required?: string;
  };
  error?: string;
}
type HostConnectionOptions = Feedback & { embedded: boolean; me: MeResponse["user"] | null; login: () => void };
export function useHostConnection({ embedded, me, login, setError, setNotice }: HostConnectionOptions) {
  const [hostOrigin] = useState(() => {
    try {
      const url = new URL(document.referrer || new URLSearchParams(location.search).get("hostOrigin") || "");
      return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
    } catch {
      return null;
    }
  });
  const [context, setContext] = useState<HostContext | null>(() =>
    embedded && (window.parent === window || !hostOrigin)
      ? { connected: false, error: MISSING_HOST_ORIGIN_ERROR }
      : null,
  );
  const latestHostContext = useRef<HostContext | null>(context);
  latestHostContext.current = context;
  const getInstallBlock = useCallback(() => installBlockReason(latestHostContext.current, embedded), [embedded]);
  const [scanning, setScanning] = useState(false);
  const [converting, setConverting] = useState(false);
  const [bridge, setBridge] = useState<InstallBridge | null>(null);
  function postToHost(payload: Record<string, unknown>): void {
    if (window.parent !== window && hostOrigin) window.parent.postMessage(payload, hostOrigin);
  }
  function updateInstallationScan(result: InstallCompletion): void {
    setContext((previous) => (previous ? { ...previous, installationScan: result.scan } : previous));
  }
  const mutations = useHostMutations({
    getInstallBlock,
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
      setError(`重新扫描失败：${formatUserError(reason)}`);
    } finally {
      setScanning(false);
    }
  }
  async function convertLegacy(worldbooks: string[]): Promise<void> {
    if (!bridge || converting || scanning) return;
    const blocked = getInstallBlock();
    if (blocked) {
      setError(blocked);
      return;
    }
    setConverting(true);
    setError(null);
    setNotice(null);
    let conversionError: string | null = null;
    try {
      const result = await bridge.convertLegacy(worldbooks);
      setNotice(`旧格式转换完成：转换 ${result.converted} 项，跳过 ${result.skipped} 项。请检查扫描结果和跳过的内容。`);
    } catch (reason) {
      conversionError = `旧格式转换失败，可能已有部分写入；请检查世界书和重新扫描结果：${formatUserError(reason)}`;
      setError(conversionError);
    } finally {
      try {
        const scan = await bridge.scan();
        setContext((previous) => (previous ? { ...previous, installationScan: scan } : previous));
      } catch (reason) {
        setError(
          `${conversionError ? `${conversionError}；` : ""}转换后重新扫描失败，请手动重新扫描并检查世界书：${formatUserError(reason)}`,
        );
      }
      setConverting(false);
    }
  }
  useEffect(() => {
    if (!embedded) return;
    if (window.parent === window || !hostOrigin) {
      const missing: HostContext = { connected: false, error: MISSING_HOST_ORIGIN_ERROR };
      latestHostContext.current = missing;
      setContext((current) => current ?? missing);
      return;
    }
    if (context !== null) return;
    const timer = window.setTimeout(() => {
      setContext((current) => {
        if (current !== null) return current;
        const timedOut: HostContext = { connected: false, error: HANDSHAKE_TIMEOUT_ERROR };
        latestHostContext.current = timedOut;
        return timedOut;
      });
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [embedded, hostOrigin, context]);
  useEffect(() => {
    if (!hostOrigin || window.parent === window) return;
    const connection = createInstallBridge({ origin: hostOrigin, source: window.parent, getInstallBlock });
    setBridge(connection);
    return () => {
      connection.dispose();
      setBridge(null);
    };
  }, [getInstallBlock, hostOrigin]);
  useHostMessages({
    postToHost,
    embedded,
    hostOrigin,
    onContext: (next) => {
      latestHostContext.current = next;
      setContext(next);
    },
  });
  function installationState(project: ProjectSummary): InstallState {
    const instances =
      context?.installationScan?.instances.filter((instance) => instance.projectId === project.id) ?? [];
    if (!instances.length) return "notInstalled";
    if (instances.some((instance) => project.publishedVersionId && instance.version !== project.publishedVersionId))
      return "updateAvailable";
    if (instances.some((instance) => instance.state === "localChanged")) return "localChanged";
    if (
      instances.some((instance) => instance.state === "baselineUnknown") ||
      context?.installationScan?.failures.length
    )
      return "scanIncomplete";
    return "upToDate";
  }
  const { connectionStatus, connectionLabel, connectionTitle, installBlock } = hostConnectionStatus(context, embedded);
  return {
    installationState,
    context,
    connectionStatus,
    connectionLabel,
    connectionTitle,
    installBlock,
    postToHost,
    bridge,
    scanning,
    converting,
    convertLegacy,
    rescanInstalls,
    ...mutations,
  };
}
