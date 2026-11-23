import { useEffect, useEffectEvent } from "react";
import { isInstallScan, isTrustedHostSource } from "../../lib/install-bridge";
import type { HostContext } from "./useHostConnection";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseWorldbooks(value: unknown): { primary: string | null; additional: string[]; available: string[] } | null {
  if (!isRecord(value)) return null;
  if (typeof value.primary !== "string" && value.primary !== null && value.primary !== undefined) return null;
  if (!Array.isArray(value.additional) || !value.additional.every((item) => typeof item === "string")) return null;
  if (!Array.isArray(value.available) || !value.available.every((item) => typeof item === "string")) return null;
  return {
    primary: typeof value.primary === "string" ? value.primary : null,
    additional: value.additional,
    available: value.available,
  };
}

function parseCompatibility(value: unknown): HostContext["installCompatibility"] | false {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return false;
  const { state, required } = value;
  if (
    state !== "compatible" &&
    state !== "version_mismatch" &&
    state !== "channel_unavailable" &&
    state !== "unverified"
  ) {
    return false;
  }
  if (required !== undefined && typeof required !== "string") return false;
  return { state, ...(typeof required === "string" ? { required } : {}) };
}

function parseHostContext(data: Record<string, unknown>): HostContext | null {
  if (typeof data.connected !== "boolean") return null;
  if (data.characterName !== undefined && data.characterName !== null && typeof data.characterName !== "string") {
    return null;
  }
  if (data.clientVersion !== undefined && typeof data.clientVersion !== "string") return null;
  if (data.error !== undefined && typeof data.error !== "string") return null;
  const compatibility = parseCompatibility(data.installCompatibility);
  if (compatibility === false) return null;

  if (!data.connected) {
    const worldbooks =
      data.worldbooks !== undefined && data.worldbooks !== null ? parseWorldbooks(data.worldbooks) : null;
    if (data.worldbooks !== undefined && data.worldbooks !== null && !worldbooks) return null;
    if (
      data.installationScan !== undefined &&
      data.installationScan !== null &&
      !isInstallScan(data.installationScan)
    ) {
      return null;
    }
    return {
      connected: false,
      characterName: typeof data.characterName === "string" ? data.characterName : null,
      worldbooks,
      installationScan: isInstallScan(data.installationScan) ? data.installationScan : null,
      clientVersion: typeof data.clientVersion === "string" ? data.clientVersion : undefined,
      installCompatibility: compatibility,
      error: typeof data.error === "string" && data.error.trim() ? data.error : undefined,
    };
  }

  const worldbooks = parseWorldbooks(data.worldbooks);
  if (!worldbooks || !isInstallScan(data.installationScan)) return null;
  return {
    connected: true,
    characterName: typeof data.characterName === "string" ? data.characterName : null,
    worldbooks,
    installationScan: data.installationScan,
    clientVersion: typeof data.clientVersion === "string" ? data.clientVersion : "",
    installCompatibility: compatibility,
    error: typeof data.error === "string" && data.error.trim() ? data.error : undefined,
  };
}

type HostMessagesOptions = {
  postToHost: (payload: Record<string, unknown>) => void;
  embedded: boolean;
  hostOrigin: string | null;
  onContext: (context: HostContext) => void;
};
export function useHostMessages({ postToHost, embedded, hostOrigin, onContext }: HostMessagesOptions) {
  const sendHostMessage = useEffectEvent((payload: Record<string, unknown>) => postToHost(payload));
  const receiveMessage = useEffectEvent((event: MessageEvent) => {
    if (!hostOrigin || window.parent === window || event.origin !== hostOrigin) return;
    if (!isTrustedHostSource(event.source, window.parent)) return;
    if (!isRecord(event.data)) return;
    if (event.data.type === "cw:context") {
      const parsed = parseHostContext(event.data);
      if (parsed) onContext(parsed);
    }
  });
  useEffect(() => {
    if (embedded) sendHostMessage({ type: "cw:ready" });
    const onMessage = (event: MessageEvent): void => receiveMessage(event);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded]);
}
