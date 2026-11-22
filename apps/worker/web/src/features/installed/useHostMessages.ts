import { useEffect, useEffectEvent } from "react";
import type { HostContext } from "./useHostConnection";

type HostMessagesOptions = {
  postToHost: (payload: Record<string, unknown>) => void;
  embedded: boolean;
  hostOrigin: string | null;
  onContext: (context: HostContext) => void;
};
export function useHostMessages({ postToHost, embedded, hostOrigin, onContext }: HostMessagesOptions) {
  const sendHostMessage = useEffectEvent((payload: Record<string, unknown>) => postToHost(payload));
  const receiveMessage = useEffectEvent((event: MessageEvent) => {
    if (!hostOrigin || event.origin !== hostOrigin || event.source !== window.parent) return;
    if (!event.data || typeof event.data !== "object") return;
    const data = event.data as Record<string, unknown>;
    if (data.type === "cw:context") onContext(data as unknown as HostContext);
  });
  useEffect(() => {
    if (embedded) sendHostMessage({ type: "cw:ready" });
    const onMessage = (event: MessageEvent): void => receiveMessage(event);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded]);
}
