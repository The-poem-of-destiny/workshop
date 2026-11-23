import type { HostContext } from "./useHostConnection";

const CONNECTION_LABELS = {
  disconnected: "未连接",
  connecting: "连接中",
  connected: "已连接",
  error: "连接出错",
} as const;
type ConnectionState = keyof typeof CONNECTION_LABELS;
export function installBlockReason(context: HostContext | null, embedded: boolean): string | null {
  if (context === null && embedded) return "正在连接 SillyTavern，等待验证安装权限。";
  if (context?.error) {
    return /[\u4e00-\u9fff]/.test(context.error) ? context.error : "无法连接 SillyTavern。请从酒馆内重新打开工坊。";
  }
  if (!context?.connected) return "安装请从 SillyTavern 内的「命定创意工坊」按钮打开。";

  const compatibility = context.installCompatibility;
  switch (compatibility?.state) {
    case "compatible":
      return null;
    case "version_mismatch": {
      const required = typeof compatibility.required === "string" ? compatibility.required : "";
      return `当前工坊脚本版本不兼容。请${required ? `更新到 ${required} 版` : "更新工坊脚本"}后重新打开工坊。仍可浏览和扫描。`;
    }
    case "channel_unavailable":
      return "当前工坊脚本的发布频道不可用。请联系工坊维护者确认频道后重新打开工坊。仍可浏览和扫描。";
    default:
      return "未能验证工坊脚本是否支持安装。请检查网络，确认使用最新工坊脚本后重新打开工坊。仍可浏览和扫描。";
  }
}

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
  const installBlock = installBlockReason(context, embedded);
  const connectionLabel =
    connectionStatus === "connected" && installBlock ? "已连接 · 安装受限" : CONNECTION_LABELS[connectionStatus];
  const connectionTitle =
    connectionStatus === "connected"
      ? `SillyTavern 已连接 · 当前角色：${context?.characterName ?? "未选择"}${installBlock ? ` · ${installBlock}` : ""}`
      : connectionStatus === "connecting"
        ? "正在连接 SillyTavern…"
        : connectionStatus === "error"
          ? `SillyTavern 连接出错：${context?.error ?? "未知原因"}`
          : "请从 SillyTavern 内打开工坊以导入项目";
  return { connectionStatus, connectionLabel, connectionTitle, installBlock };
}
