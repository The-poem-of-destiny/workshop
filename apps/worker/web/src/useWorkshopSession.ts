import { useEffect, useRef, useState } from "react";
import { api, type MeResponse, setSessionToken } from "./api";
import type { WorkshopView } from "./useWorkshopNavigation";

type Feedback = { setError: (message: string | null) => void; setNotice: (message: string | null) => void };

type WorkshopSessionOptions = Feedback & { embedded: boolean; setView: (view: WorkshopView) => void };

function waitForDevicePoll(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let timer: number | undefined;
    const finish = (): void => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const onVisibility = (): void => {
      clearTimeout(timer);
      if (!document.hidden) finish();
    };
    document.addEventListener("visibilitychange", onVisibility);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
    else if (!document.hidden) timer = window.setTimeout(finish, delay);
  });
}

async function pollDeviceFlow(
  id: string,
  deviceCode: string,
  signal: AbortSignal,
  startedAt: number,
  deadline: number,
  previous: Promise<void> | null,
  onAuthorized: (token: string) => Promise<void>,
  setError: Feedback["setError"],
): Promise<void> {
  await previous;
  while (!signal.aborted && Date.now() < deadline) {
    await waitForDevicePoll(signal, Date.now() - startedAt < 15_000 ? 3000 : 10_000);
    if (signal.aborted) return;
    if (Date.now() >= deadline) {
      setError("等待登录超时，请重新发起。");
      return;
    }
    const status = await api.authFlowStatus(id, deviceCode);
    if (signal.aborted) return;
    if (status.status === "authorized") {
      const session = await api.redeemFlow(id, deviceCode);
      if (!signal.aborted) await onAuthorized(session.token);
      return;
    }
    if (status.status === "expired") {
      setError("登录已过期，请重新发起。");
      return;
    }
    if (status.status === "redeemed") {
      setError("登录凭据已被使用，请重新发起。");
      return;
    }
  }
}

export function useWorkshopSession({ embedded, setError, setNotice, setView }: WorkshopSessionOptions) {
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [loginFallback, setLoginFallback] = useState<string | null>(null);
  const deviceLogin = useRef<AbortController | null>(null);
  const devicePoll = useRef<Promise<void> | null>(null);
  useEffect(() => () => deviceLogin.current?.abort(), []);
  async function refreshMe(): Promise<void> {
    if (!api.hasSession()) return;
    try {
      const value = await api.me();
      setMe(value.user);
    } catch {
      setSessionToken(null);
      setMe(null);
    }
  }
  function login(): void {
    deviceLogin.current?.abort();
    const controller = embedded ? new AbortController() : null;
    deviceLogin.current = controller;
    setError(null);
    setLoginFallback(null);
    const mode = embedded ? "device" : "browser";
    void api
      .createFlow(mode)
      .then(async (flow) => {
        if (controller?.signal.aborted) return;
        if (mode === "browser") {
          const onMessage = (event: MessageEvent): void => {
            if (event.origin !== location.origin) return;
            const data: { type?: unknown; token?: unknown } = event.data;
            if (data.type !== "oauth-success" || typeof data.token !== "string") return;
            setSessionToken(data.token);
            setLoginFallback(null);
            window.removeEventListener("message", onMessage);
            void refreshMe();
          };
          window.addEventListener("message", onMessage);
        }
        const popup = window.open(flow.url, "cw-discord-login", "width=520,height=720");
        if (!popup) {
          setLoginFallback(flow.url);
          setNotice("请在打开的新页面完成 Discord 登录，本页会自动继续。");
        }
        if (mode !== "device" || !flow.deviceCode) return;
        if (!controller) return;
        const deviceCode = flow.deviceCode;
        const startedAt = Date.now();
        const deadline = startedAt + 10 * 60 * 1000;
        const timeout = setTimeout(() => {
          if (!controller.signal.aborted) {
            controller.abort();
            setError("等待登录超时，请重新发起。");
          }
        }, deadline - Date.now());
        const clearDeadline = (): void => {
          clearTimeout(timeout);
        };
        controller.signal.addEventListener("abort", clearDeadline, { once: true });
        const previous = devicePoll.current;
        const polling = pollDeviceFlow(
          flow.id,
          deviceCode,
          controller.signal,
          startedAt,
          deadline,
          previous,
          async (token) => {
            setSessionToken(token);
            setLoginFallback(null);
            setNotice("登录成功。");
            await refreshMe();
          },
          setError,
        ).catch((reason) => {
          if (!controller.signal.aborted) setError(String(reason));
        });
        devicePoll.current = polling;
        try {
          await polling;
        } finally {
          clearTimeout(timeout);
          controller.signal.removeEventListener("abort", clearDeadline);
          if (devicePoll.current === polling) devicePoll.current = null;
          if (deviceLogin.current === controller) deviceLogin.current = null;
        }
      })
      .catch((reason) => {
        if (!controller?.signal.aborted) setError(String(reason));
      });
  }
  function logout(): void {
    deviceLogin.current?.abort();
    void api.logout().finally(() => {
      setMe(null);
      setView("browse");
    });
  }
  return { me, logout, login, loginFallback, refreshMe };
}
