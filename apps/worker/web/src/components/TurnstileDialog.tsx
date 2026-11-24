import { useCallback, useEffect, useRef, useState } from "react";
import { loadTurnstileScript, registerTurnstileInteractiveRequester, type TurnstileApi } from "../lib/turnstile";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

interface PendingChallenge {
  siteKey: string;
  attempt: number;
  resolve: (token: string) => void;
  reject: (reason: Error) => void;
}

export function TurnstileDialog() {
  const [pending, setPending] = useState<PendingChallenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<PendingChallenge | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    registerTurnstileInteractiveRequester(
      (siteKey) =>
        new Promise<string>((resolve, reject) => {
          if (pendingRef.current) {
            pendingRef.current.reject(new Error("人机验证已取消，请重试。"));
          }
          setError(null);
          setPending({ siteKey, attempt: 1, resolve, reject });
        }),
    );
    return () => {
      registerTurnstileInteractiveRequester(null);
      if (pendingRef.current) {
        pendingRef.current.reject(new Error("人机验证已取消，请重试。"));
        pendingRef.current = null;
      }
    };
  }, []);

  const cancel = useCallback(() => {
    const current = pendingRef.current;
    setPending(null);
    setError(null);
    current?.reject(new Error("已取消人机验证。"));
  }, []);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    let apiRef: TurnstileApi | null = null;
    let widgetId: string | null = null;

    const mount = async () => {
      setError(null);
      try {
        const turnstile = await loadTurnstileScript();
        if (cancelled || !containerRef.current) return;
        apiRef = turnstile;
        containerRef.current.innerHTML = "";
        widgetId = turnstile.render(containerRef.current, {
          sitekey: pending.siteKey,
          theme: "dark",
          language: "zh-CN",
          callback: (token) => {
            if (cancelled) return;
            const current = pendingRef.current;
            setPending(null);
            setError(null);
            current?.resolve(token);
          },
          "error-callback": () => {
            if (cancelled) return;
            setError("人机验证未通过，请点击重试，或检查代理及广告拦截插件是否拦截了 challenges.cloudflare.com。");
          },
          "expired-callback": () => {
            if (cancelled) return;
            setError("验证已过期，请重新完成验证。");
          },
        });
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "人机验证组件加载失败，请重试。");
      }
    };

    void mount();
    return () => {
      cancelled = true;
      if (apiRef && widgetId) {
        try {
          apiRef.remove(widgetId);
        } catch {
          /* ignore */
        }
      }
    };
  }, [pending]);

  if (!pending) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="max-w-md" aria-modal="true">
        <DialogHeader>
          <DialogTitle>安全验证</DialogTitle>
          <DialogDescription>为防止批量爬取世界书与正则内容，请稍候或完成下方人机验证。</DialogDescription>
        </DialogHeader>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            padding: "16px 20px 8px",
            minHeight: "96px",
          }}
        >
          <div ref={containerRef} />
          {error ? (
            <p style={{ margin: 0, color: "var(--danger)", fontSize: "13px", textAlign: "center", lineHeight: 1.5 }}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="confirm-dialog-actions">
          {error ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPending((current) => (current ? { ...current, attempt: current.attempt + 1 } : null))}
            >
              重试
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={cancel}>
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
