const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_TTL_MS = 240_000;
const SCRIPT_TIMEOUT_MS = 10_000;

export interface TurnstileConfig {
  enabled: boolean;
  siteKey: string | null;
}

export interface TurnstileRenderOptions {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  language?: string;
  callback?: (token: string) => void;
  "error-callback"?: (code?: string) => void;
  "expired-callback"?: () => void;
  "before-interactive-callback"?: () => void;
}

export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let configPromise: Promise<TurnstileConfig> | null = null;
let scriptPromise: Promise<TurnstileApi> | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;
let prefetchActive = false;

type InteractiveRequester = (siteKey: string) => Promise<string>;
let interactiveRequester: InteractiveRequester | null = null;

export function registerTurnstileInteractiveRequester(requester: InteractiveRequester | null): void {
  interactiveRequester = requester;
}

export function loadTurnstileConfig(): Promise<TurnstileConfig> {
  if (!configPromise) {
    configPromise = fetch("/api/v1/turnstile/config", { credentials: "omit", headers: { accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) return { enabled: false, siteKey: null };
        const data = (await res.json()) as { enabled?: unknown; siteKey?: unknown };
        return {
          enabled: data.enabled === true && typeof data.siteKey === "string" && data.siteKey.length > 0,
          siteKey: typeof data.siteKey === "string" && data.siteKey.length > 0 ? data.siteKey : null,
        };
      })
      .catch(() => ({ enabled: false, siteKey: null }));
  }
  return configPromise;
}

export function loadTurnstileScript(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("当前环境无法加载人机验证组件。"));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
    const timer = window.setTimeout(() => {
      scriptPromise = null;
      reject(new Error("人机验证组件加载超时，请检查代理或临时关闭广告拦截后重试。"));
    }, SCRIPT_TIMEOUT_MS);

    const onReady = () => {
      window.clearTimeout(timer);
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        scriptPromise = null;
        reject(new Error("人机验证组件未能初始化，请检查网络或广告拦截规则后重试。"));
      }
    };

    const onError = () => {
      window.clearTimeout(timer);
      scriptPromise = null;
      reject(new Error("人机验证组件加载失败，请检查代理或放行 challenges.cloudflare.com 后重试。"));
    };

    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", onError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener("error", onError, { once: true });
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function consumeCachedToken(): string | null {
  if (!cachedToken) return null;
  const current = cachedToken;
  cachedToken = null;
  return current.expiresAt > Date.now() ? current.value : null;
}

export function clearCachedTurnstileToken(): void {
  cachedToken = null;
}

export async function prefetchTurnstileToken(): Promise<void> {
  if (typeof window === "undefined" || prefetchActive) return;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return;

  const config = await loadTurnstileConfig();
  if (!config.enabled || !config.siteKey) return;

  prefetchActive = true;
  let host: HTMLDivElement | null = null;
  let widgetId: string | null = null;
  let apiRef: TurnstileApi | null = null;
  let timeoutId = 0;

  const cleanup = () => {
    window.clearTimeout(timeoutId);
    if (apiRef && widgetId) {
      try {
        apiRef.remove(widgetId);
      } catch {
        /* ignore */
      }
    }
    if (host?.parentNode) host.parentNode.removeChild(host);
    prefetchActive = false;
  };

  try {
    const turnstile = await loadTurnstileScript();
    apiRef = turnstile;
    host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.position = "fixed";
    host.style.left = "-9999px";
    host.style.top = "-9999px";
    host.style.width = "1px";
    host.style.height = "1px";
    host.style.overflow = "hidden";
    host.style.opacity = "0";
    host.style.pointerEvents = "none";
    document.body.appendChild(host);

    timeoutId = window.setTimeout(cleanup, 12_000);
    widgetId = turnstile.render(host, {
      sitekey: config.siteKey,
      theme: "dark",
      language: "zh-CN",
      callback: (value) => {
        cachedToken = { value, expiresAt: Date.now() + TOKEN_TTL_MS };
        cleanup();
      },
      "before-interactive-callback": () => {
        // Cloudflare 需要用户手动点选时，静默结束预取，等用户真正触发操作时再弹窗
        cleanup();
      },
      "error-callback": () => {
        cleanup();
      },
      "expired-callback": () => {
        cleanup();
      },
    });
  } catch {
    cleanup();
  }
}

export async function acquireTurnstileToken(forceInteractive = false): Promise<string | null> {
  const config = await loadTurnstileConfig();
  if (!config.enabled || !config.siteKey) return null;

  if (!forceInteractive) {
    const prefetched = consumeCachedToken();
    if (prefetched) {
      void prefetchTurnstileToken();
      return prefetched;
    }
  } else {
    clearCachedTurnstileToken();
  }

  if (!interactiveRequester) {
    throw new Error("人机验证组件尚未就绪，请刷新页面后重试。");
  }
  const token = await interactiveRequester(config.siteKey);
  void prefetchTurnstileToken();
  return token;
}
