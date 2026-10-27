import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useEffectEvent } from "react";
import type { HostContext } from "./useHostConnection";

type HostMessagesOptions = {
  postToHost: (payload: Record<string, unknown>) => void;
  embedded: boolean;
  setContext: Dispatch<SetStateAction<HostContext | null>>;
  setInstalling: (value: boolean) => void;
  hostMutationPending: RefObject<boolean>;
  setUpdatingId: (value: string | null) => void;
  setNotice: (message: string | null) => void;
  setInstallConflicts: (value: string[] | null) => void;
  setScanning: (value: boolean) => void;
  setError: (message: string | null) => void;
};
export function useHostMessages({
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
}: HostMessagesOptions) {
  const sendHostMessage = useEffectEvent((payload: Record<string, unknown>) => postToHost(payload));
  const receiveInstall = useEffectEvent((data: Record<string, unknown>) => {
    setInstalling(false);
    hostMutationPending.current = false;
    setUpdatingId(null);
    setNotice(data.ok ? "安装完成。" : `安装失败：${String(data.message ?? "")}`);
    if (data.ok) {
      const conflicts = Array.isArray(data.conflicts)
        ? data.conflicts.filter((value): value is string => typeof value === "string")
        : [];
      setInstallConflicts(conflicts.length > 0 ? conflicts : null);
      sendHostMessage({ type: "cw:request-context" });
    }
  });
  const receiveUninstall = useEffectEvent((data: Record<string, unknown>) => {
    setInstalling(false);
    hostMutationPending.current = false;
    const preservedEntries = Number(data.preservedEntries ?? 0);
    const preservedRegexes = Number(data.preservedRegexes ?? 0);
    setNotice(
      data.ok
        ? preservedEntries + preservedRegexes > 0
          ? `卸载完成；保留了 ${preservedEntries} 个玩家修改条目、${preservedRegexes} 条玩家修改正则。`
          : "卸载完成。"
        : `卸载失败：${String(data.message ?? "")}`,
    );
    if (data.ok) sendHostMessage({ type: "cw:request-context" });
  });
  const receiveScan = useEffectEvent((data: Record<string, unknown>) => {
    setScanning(false);
    if (data.ok) {
      setContext((previous) =>
        previous
          ? {
              ...previous,
              registry: (data.registry as HostContext["registry"]) ?? previous.registry,
              installStates: (data.installStates as HostContext["installStates"]) ?? previous.installStates,
            }
          : previous,
      );
    } else {
      setError(`重新扫描失败：${String(data.message ?? "")}`);
    }
  });
  const receiveMessage = useEffectEvent((event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const data: { type?: unknown; [key: string]: unknown } = event.data;
    if (typeof data.type !== "string") return;
    switch (data.type) {
      case "cw:context":
        setContext(data as unknown as HostContext);
        break;
      case "cw:install-result":
        receiveInstall(data);
        break;
      case "cw:uninstall-result":
        receiveUninstall(data);
        break;
      case "cw:scan-result":
        receiveScan(data);
        break;
    }
  });
  useEffect(() => {
    if (embedded) sendHostMessage({ type: "cw:ready" });
    const onMessage = (event: MessageEvent): void => receiveMessage(event);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded]);
}
