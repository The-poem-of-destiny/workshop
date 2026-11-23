import { type MutableRefObject, useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  formatUserError,
  getSessionGeneration,
  type MeResponse,
  setSessionToken,
  type UserPolicyState,
} from "../api";
import type { WorkshopView } from "./useWorkshopNavigation";

type Feedback = { setError: (message: string | null) => void; setNotice: (message: string | null) => void };
type WorkshopSessionOptions = Feedback & { embedded: boolean; setView: (view: WorkshopView) => void };

function isGuildAdmissionError(message: string): boolean {
  return message.includes("不在允许的 Discord 服务器中") || message.includes("缺少允许的 Discord 身份组");
}

function authFlowLaunchPath(flowId: string): string {
  return `/api/v1/auth/flows/${encodeURIComponent(flowId)}/launch`;
}

function registerLaunchBindListener(flowId: string, binding: string | null, signal: AbortSignal): void {
  if (!binding) return;
  const onLaunchMessage = (event: MessageEvent): void => {
    if (event.origin !== location.origin || signal.aborted) return;
    if (!event.data || typeof event.data !== "object") return;
    const data = event.data as { type?: unknown; flowId?: unknown };
    if (data.type !== "cw:oauth-launch-ready" || data.flowId !== flowId) return;
    (event.source as WindowProxy | null)?.postMessage(
      { type: "cw:oauth-launch-bind", flowId, binding },
      location.origin,
    );
  };
  window.addEventListener("message", onLaunchMessage, { signal });
}

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
  onError: (message: string) => void,
): Promise<void> {
  await previous;
  while (!signal.aborted && Date.now() < deadline) {
    await waitForDevicePoll(signal, Date.now() - startedAt < 15_000 ? 3000 : 10_000);
    if (signal.aborted) return;
    if (Date.now() >= deadline) {
      onError("等待登录超时，请重新发起。");
      return;
    }
    const status = await api.authFlowStatus(id, deviceCode);
    if (signal.aborted) return;
    if (status.error) {
      onError(formatUserError(status.error));
      return;
    }
    if (status.status === "authorized") {
      const session = await api.redeemFlow(id, deviceCode);
      if (!signal.aborted) await onAuthorized(session.token);
      return;
    }
    if (status.status === "expired") {
      onError("登录已过期，请重新发起。");
      return;
    }
    if (status.status === "redeemed") {
      onError("登录凭据已被使用，请重新发起。");
      return;
    }
  }
}

async function runDeviceFlowPolling({
  flowId,
  deviceCode,
  controller,
  loginController,
  devicePoll,
  setLoginFallback,
  setError,
  onSuccess,
  onFailure,
}: {
  flowId: string;
  deviceCode: string;
  controller: AbortController;
  loginController: MutableRefObject<AbortController | null>;
  devicePoll: MutableRefObject<Promise<void> | null>;
  setLoginFallback: (url: string | null) => void;
  setError: Feedback["setError"];
  onSuccess: (token: string, notify: boolean) => Promise<void>;
  onFailure: (message: string, hasExplicitInvite?: boolean) => void;
}): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + 10 * 60 * 1000;
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort();
      setError("等待登录超时，请重新发起。");
    }
  }, deadline - Date.now());
  const clearDeadline = (): void => clearTimeout(timeout);
  controller.signal.addEventListener("abort", clearDeadline, { once: true });
  const polling = pollDeviceFlow(
    flowId,
    deviceCode,
    controller.signal,
    startedAt,
    deadline,
    devicePoll.current,
    (token) => onSuccess(token, true),
    (message) => {
      controller.abort();
      setLoginFallback(null);
      onFailure(message);
    },
  ).catch((reason) => {
    if (!controller.signal.aborted) setError(formatUserError(reason));
  });
  devicePoll.current = polling;
  try {
    await polling;
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", clearDeadline);
    if (devicePoll.current === polling) devicePoll.current = null;
    if (loginController.current === controller) loginController.current = null;
  }
}

async function executeOAuthFlow({
  mode,
  controller,
  loginController,
  devicePoll,
  setLoginFallback,
  setNotice,
  setError,
  onSuccess,
  onFailure,
}: {
  mode: "browser" | "device";
  controller: AbortController;
  loginController: MutableRefObject<AbortController | null>;
  devicePoll: MutableRefObject<Promise<void> | null>;
  setLoginFallback: (url: string | null) => void;
  setNotice: Feedback["setNotice"];
  setError: Feedback["setError"];
  onSuccess: (token: string, notify: boolean) => Promise<void>;
  onFailure: (message: string, hasExplicitInvite?: boolean) => void;
}): Promise<void> {
  if (mode === "browser") {
    const { flow } = await api.createAuthFlow("browser");
    if (controller.signal.aborted) return;
    const browserListener = new AbortController();
    const abortBrowserListener = (): void => browserListener.abort();
    controller.signal.addEventListener("abort", abortBrowserListener, { once: true });
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== location.origin || browserListener.signal.aborted || controller.signal.aborted) return;
      const data: { type?: unknown; state?: unknown; token?: unknown; error?: unknown; inviteUrl?: unknown } =
        event.data ?? {};
      if (data.state !== flow.state) return;
      if (data.type === "oauth-error" && typeof data.error === "string") {
        controller.abort();
        if (loginController.current === controller) loginController.current = null;
        setLoginFallback(null);
        onFailure(formatUserError(data.error), typeof data.inviteUrl === "string" && data.inviteUrl.length > 0);
        return;
      }
      if (data.type !== "oauth-success" || typeof data.token !== "string") return;
      controller.abort();
      if (loginController.current === controller) loginController.current = null;
      void onSuccess(data.token, false);
    };
    window.addEventListener("message", onMessage, { signal: browserListener.signal });
    const popup = window.open(flow.url, "cw-discord-login", "width=520,height=720");
    if (popup) return;
    browserListener.abort();
    controller.signal.removeEventListener("abort", abortBrowserListener);

    const { flow: deviceFlow, binding: deviceBinding } = await api.createAuthFlow("device");
    if (controller.signal.aborted || !deviceFlow.deviceCode) return;
    registerLaunchBindListener(deviceFlow.id, deviceBinding, controller.signal);
    setLoginFallback(authFlowLaunchPath(deviceFlow.id));
    setNotice("请在打开的新页面完成 Discord 登录，本页会自动继续。");
    await runDeviceFlowPolling({
      flowId: deviceFlow.id,
      deviceCode: deviceFlow.deviceCode,
      controller,
      loginController,
      devicePoll,
      setLoginFallback,
      setError,
      onSuccess,
      onFailure,
    });
    return;
  }

  const { flow, binding } = await api.createAuthFlow("device");
  if (controller.signal.aborted || !flow.deviceCode) return;
  registerLaunchBindListener(flow.id, binding, controller.signal);
  const launchUrl = authFlowLaunchPath(flow.id);
  const popup = window.open(launchUrl, "cw-discord-login", "width=520,height=720");
  if (!popup) {
    setLoginFallback(launchUrl);
    setNotice("请在打开的新页面完成 Discord 登录，本页会自动继续。");
  }
  await runDeviceFlowPolling({
    flowId: flow.id,
    deviceCode: flow.deviceCode,
    controller,
    loginController,
    devicePoll,
    setLoginFallback,
    setError,
    onSuccess,
    onFailure,
  });
}

export function useWorkshopSession({ embedded, setError, setNotice, setView }: WorkshopSessionOptions) {
  const [account, setAccount] = useState<MeResponse | null>(null);
  const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
  const [authInviteHint, setAuthInviteHint] = useState(false);
  const [loginFallback, setLoginFallback] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const loginController = useRef<AbortController | null>(null);
  const devicePoll = useRef<Promise<void> | null>(null);
  const promptedGeneration = useRef<number>(-1);

  useEffect(() => () => loginController.current?.abort(), []);

  const me = account?.policy.accepted ? account.user : null;
  const pendingPolicyUser = account && !account.policy.accepted ? account.user : null;
  const policyState: UserPolicyState | null = account?.policy ?? null;

  async function refreshMe(forceOpenPolicy = false): Promise<void> {
    if (!api.hasSession()) {
      setAccount(null);
      return;
    }
    const generation = getSessionGeneration();
    setSessionError(false);
    try {
      const value = await api.me();
      if (generation !== getSessionGeneration()) return;
      setAccount(value);
      if (!value.policy.accepted && (forceOpenPolicy || promptedGeneration.current !== generation)) {
        promptedGeneration.current = generation;
        setPolicyDialogOpen(true);
      }
    } catch (reason) {
      if (generation !== getSessionGeneration()) return;
      if (reason instanceof ApiError && reason.status === 401) {
        setSessionToken(null);
        setAccount(null);
      } else {
        setSessionError(true);
      }
    }
  }

  function login(): void {
    if (pendingPolicyUser) {
      setPolicyDialogOpen(true);
      return;
    }
    loginController.current?.abort();
    const controller = new AbortController();
    loginController.current = controller;
    setError(null);
    setAuthInviteHint(false);
    setLoginFallback(null);
    void executeOAuthFlow({
      mode: embedded ? "device" : "browser",
      controller,
      loginController,
      devicePoll,
      setLoginFallback,
      setNotice,
      setError,
      onSuccess: async (token, notify) => {
        setSessionToken(token);
        setLoginFallback(null);
        setAuthInviteHint(false);
        if (notify) setNotice("登录成功。");
        await refreshMe(true);
      },
      onFailure: (message, hasExplicitInvite = false) => {
        setError(message);
        setAuthInviteHint(hasExplicitInvite || isGuildAdmissionError(message));
      },
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(formatUserError(reason));
    });
  }

  function completePolicy(nextPolicy: UserPolicyState): void {
    setAccount((current) => (current ? { ...current, policy: nextPolicy } : current));
    setPolicyDialogOpen(false);
    setNotice("已完成工坊使用政策确认，现在可以正常使用全部功能。");
  }

  function logout(): void {
    loginController.current?.abort();
    setLoginFallback(null);
    setAuthInviteHint(false);
    setPolicyDialogOpen(false);
    const generation = getSessionGeneration();
    setError(null);
    void api
      .logout()
      .then(() => {
        if (generation !== getSessionGeneration() && api.hasSession()) return;
        setAccount(null);
        setSessionError(false);
        setView("browse");
      })
      .catch(() => {
        if (generation === getSessionGeneration()) {
          setError("退出登录失败，请检查网络后再次点击退出登录。");
        }
      });
  }

  return {
    me,
    pendingPolicyUser,
    policyState,
    policyDialogOpen,
    setPolicyDialogOpen,
    completePolicy,
    authInviteHint,
    clearAuthInviteHint: () => setAuthInviteHint(false),
    logout,
    login,
    loginFallback,
    refreshMe,
    sessionError,
  };
}
