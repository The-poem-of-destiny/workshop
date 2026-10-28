import type { InstallIntent, InstallPreview, InstallScan } from "@workshop/contracts";

export type InstallCompletion = { instanceId: string; action: InstallIntent["action"]; scan: InstallScan };
export interface InstallBridge {
  scan(): Promise<InstallScan>;
  preview(intent: InstallIntent): Promise<InstallPreview>;
  confirm(previewId: string): Promise<InstallCompletion>;
  cancel(previewId: string): Promise<{ cancelled: boolean }>;
  dispose(): void;
}

/** One bridge per host connection. The caller supplies the trusted, exact host origin. */
export function createInstallBridge({
  origin,
  source = window.parent,
  timeoutMs = 30_000,
}: {
  origin: string;
  source?: Window;
  timeoutMs?: number;
}): InstallBridge {
  if (origin === "*" || origin === "null" || new URL(origin).origin !== origin) {
    throw new Error("安装桥需要明确的宿主 origin");
  }
  let disposed = false;
  const pending = new Map<
    string,
    {
      type: string;
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: number;
    }
  >();
  function onMessage(event: MessageEvent): void {
    if (event.origin !== origin || event.source !== source || !event.data || typeof event.data !== "object") return;
    const data = event.data as Record<string, unknown>;
    if (typeof data.requestId !== "string") return;
    const request = pending.get(data.requestId);
    if (!request || data.type !== `${request.type}-result` || typeof data.ok !== "boolean") return;
    pending.delete(data.requestId);
    clearTimeout(request.timer);
    if (data.ok) request.resolve(data.result);
    else request.reject(new Error(typeof data.message === "string" ? data.message : "宿主操作失败"));
  }
  window.addEventListener("message", onMessage);
  function request<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (disposed) return Promise.reject(new Error("安装连接已关闭"));
    // Correlation only; getRandomValues also works in local HTTP previews.
    const requestId = Array.from(crypto.getRandomValues(new Uint32Array(4)), (word) =>
      word.toString(16).padStart(8, "0"),
    ).join("");
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        reject(
          new Error(
            type === "cw:confirm-install"
              ? "等待安装结果超时；写入结果未知，请关闭并重新扫描，勿重复确认。"
              : "等待宿主响应超时，请重试。",
          ),
        );
      }, timeoutMs);
      pending.set(requestId, { type, resolve: (value) => resolve(value as T), reject, timer });
      try {
        source.postMessage({ type, requestId, ...payload }, origin);
      } catch (reason) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      }
    });
  }
  return {
    scan: () => request<InstallScan>("cw:scan"),
    preview: (intent) => request<InstallPreview>("cw:preview-install", { intent }),
    confirm: (previewId) => request<InstallCompletion>("cw:confirm-install", { previewId }),
    cancel: (previewId) => request<{ cancelled: boolean }>("cw:cancel-install", { previewId }),
    dispose() {
      disposed = true;
      window.removeEventListener("message", onMessage);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("安装连接已关闭"));
      }
      pending.clear();
    },
  };
}
