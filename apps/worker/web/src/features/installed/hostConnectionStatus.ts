import type { HostContext } from "./useHostConnection";

const CONNECTION_LABELS = {
  disconnected: "未连接",
  connecting: "连接中",
  connected: "已连接",
  error: "连接出错",
} as const;
type ConnectionState = keyof typeof CONNECTION_LABELS;
export function hostConnectionStatus(context: HostContext | null, embedded: boolean) {
  const connectionStatus: ConnectionState =
    context === null
      ? embedded
        ? "connecting"
        : "disconnected"
      : context.error
        ? "error"
        : context.connected
          ? "connected"
          : "disconnected";
  const connectionLabel = CONNECTION_LABELS[connectionStatus];
  const connectionTitle =
    connectionStatus === "connected"
      ? `SillyTavern 已连接 · 当前角色：${context?.characterName ?? "未选择"}`
      : connectionStatus === "connecting"
        ? "正在连接 SillyTavern…"
        : connectionStatus === "error"
          ? `SillyTavern 连接出错：${context?.error ?? "未知原因"}`
          : "请从 SillyTavern 内打开工坊以导入项目";
  return { connectionStatus, connectionLabel, connectionTitle };
}
