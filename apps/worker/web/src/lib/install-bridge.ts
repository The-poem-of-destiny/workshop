import type {
  InstallDiff,
  InstallInstance,
  InstallIntent,
  InstallLocation,
  InstallPreview,
  InstallScan,
} from "@workshop/contracts";

export type InstallCompletion = { instanceId: string; action: InstallIntent["action"]; scan: InstallScan };
export interface InstallBridge {
  scan(): Promise<InstallScan>;
  convertLegacy(worldbooks: string[]): Promise<{ converted: number; skipped: number }>;
  preview(intent: InstallIntent): Promise<InstallPreview>;
  confirm(previewId: string): Promise<InstallCompletion>;
  cancel(previewId: string): Promise<{ cancelled: boolean }>;
  dispose(): void;
}

export function isTrustedHostSource(eventSource: MessageEventSource | null, expectedHost: Window): boolean {
  if (eventSource === expectedHost) return true;
  try {
    return (
      eventSource !== null &&
      typeof eventSource === "object" &&
      "parent" in eventSource &&
      (eventSource as Window).parent === expectedHost
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInstallAction(value: unknown): value is InstallIntent["action"] {
  return value === "install" || value === "update" || value === "uninstall" || value === "migrate";
}

function isInstallLocation(value: unknown): value is InstallLocation {
  return (
    isRecord(value) &&
    (typeof value.worldbook === "string" || value.worldbook === null) &&
    (typeof value.character === "string" || value.character === null)
  );
}

function isInstallInstance(value: unknown): value is InstallInstance {
  return (
    isRecord(value) &&
    typeof value.instanceId === "string" &&
    typeof value.projectId === "string" &&
    typeof value.version === "string" &&
    isInstallLocation(value.location) &&
    (value.source === "native" || value.source === "legacy") &&
    (value.state === "clean" || value.state === "localChanged" || value.state === "baselineUnknown") &&
    typeof value.entryCount === "number" &&
    typeof value.regexCount === "number"
  );
}

export function isInstallScan(value: unknown): value is InstallScan {
  if (!isRecord(value) || !Array.isArray(value.instances) || !value.instances.every(isInstallInstance)) return false;
  if (!isRecord(value.scope) || !Array.isArray(value.scope.worldbooks)) return false;
  if (!value.scope.worldbooks.every((item) => typeof item === "string")) return false;
  if (typeof value.scope.character !== "string" && value.scope.character !== null) return false;
  if (
    !Array.isArray(value.failures) ||
    !value.failures.every((f) => isRecord(f) && typeof f.location === "string" && typeof f.reason === "string")
  ) {
    return false;
  }
  return (
    Array.isArray(value.ambiguous) &&
    value.ambiguous.every(
      (a) =>
        isRecord(a) && typeof a.location === "string" && typeof a.reason === "string" && typeof a.guidance === "string",
    )
  );
}

function isInstallDiff(value: unknown): value is InstallDiff {
  return (
    isRecord(value) &&
    (value.kind === "worldbook" || value.kind === "regex") &&
    typeof value.key === "string" &&
    (typeof value.before === "string" || value.before === null) &&
    (typeof value.after === "string" || value.after === null)
  );
}

function isValidBridgeResult(type: string, result: unknown): boolean {
  switch (type) {
    case "cw:scan":
      return isInstallScan(result);
    case "cw:convert-legacy":
      return isRecord(result) && typeof result.converted === "number" && typeof result.skipped === "number";
    case "cw:preview-install":
      return (
        isRecord(result) &&
        typeof result.previewId === "string" &&
        typeof result.instanceId === "string" &&
        isInstallAction(result.action) &&
        (result.instance === null || isInstallInstance(result.instance)) &&
        isInstallLocation(result.target) &&
        Array.isArray(result.playerChanges) &&
        result.playerChanges.every(isInstallDiff) &&
        Array.isArray(result.changes) &&
        result.changes.every(isInstallDiff)
      );
    case "cw:confirm-install":
      return (
        isRecord(result) &&
        typeof result.instanceId === "string" &&
        isInstallAction(result.action) &&
        isInstallScan(result.scan)
      );
    case "cw:cancel-install":
      return isRecord(result) && typeof result.cancelled === "boolean";
    default:
      return false;
  }
}

/** One bridge per host connection. The caller supplies the trusted, exact host origin. */
export function createInstallBridge({
  origin,
  getInstallBlock,
  source = window.parent,
  timeoutMs = 30_000,
}: {
  origin: string;
  getInstallBlock: () => string | null;
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
    if (
      event.origin !== origin ||
      !isTrustedHostSource(event.source, source) ||
      !event.data ||
      typeof event.data !== "object"
    ) {
      return;
    }
    const data = event.data as Record<string, unknown>;
    if (typeof data.requestId !== "string") return;
    const request = pending.get(data.requestId);
    if (!request || data.type !== `${request.type}-result` || typeof data.ok !== "boolean") return;
    pending.delete(data.requestId);
    clearTimeout(request.timer);
    if (data.ok) {
      if (isValidBridgeResult(request.type, data.result)) {
        request.resolve(data.result);
      } else {
        request.reject(new Error("宿主返回的数据格式无效，请更新工坊脚本后重试。"));
      }
    } else {
      request.reject(new Error(typeof data.message === "string" ? data.message : "宿主操作失败"));
    }
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
            type === "cw:confirm-install" || type === "cw:convert-legacy"
              ? "等待宿主写入结果超时；结果未知，请重新扫描并检查世界书，勿立即重复操作。"
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
  function protectedRequest<T>(type: string, payload: Record<string, unknown>): Promise<T> {
    const blocked = getInstallBlock();
    return blocked ? Promise.reject(new Error(blocked)) : request<T>(type, payload);
  }
  return {
    scan: () => request<InstallScan>("cw:scan"),
    convertLegacy: (worldbooks) =>
      protectedRequest<{ converted: number; skipped: number }>("cw:convert-legacy", { worldbooks }),
    preview: (intent) => protectedRequest<InstallPreview>("cw:preview-install", { intent }),
    confirm: (previewId) => protectedRequest<InstallCompletion>("cw:confirm-install", { previewId }),
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
