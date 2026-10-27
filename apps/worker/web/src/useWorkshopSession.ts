import { useState } from "react";
import { api, type MeResponse, setSessionToken } from "./api";
import type { WorkshopView } from "./useWorkshopNavigation";

type Feedback = { setError: (message: string | null) => void; setNotice: (message: string | null) => void };

type WorkshopSessionOptions = Feedback & { embedded: boolean; setView: (view: WorkshopView) => void };
export function useWorkshopSession({ embedded, setError, setNotice, setView }: WorkshopSessionOptions) {
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [loginFallback, setLoginFallback] = useState<string | null>(null);
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
    setError(null);
    setLoginFallback(null);
    const mode = embedded ? "device" : "browser";
    void api
      .createFlow(mode)
      .then(async (flow) => {
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
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const status = await api.authFlowStatus(flow.id, flow.deviceCode);
          if (status.status === "authorized") {
            const session = await api.redeemFlow(flow.id, flow.deviceCode);
            setSessionToken(session.token);
            setLoginFallback(null);
            setNotice("登录成功。");
            await refreshMe();
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
        setError("等待登录超时，请重新发起。");
      })
      .catch((reason) => setError(String(reason)));
  }
  function logout(): void {
    void api.logout().finally(() => {
      setMe(null);
      setView("browse");
    });
  }
  return { me, logout, login, loginFallback, refreshMe };
}
