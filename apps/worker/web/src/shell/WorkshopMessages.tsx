import { Megaphone, ShieldAlert, X } from "lucide-react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { MeResponse, SiteSettings } from "../api";
import { parseSiteContent } from "../lib/siteContent";
import type { useWorkshopNavigation } from "./useWorkshopNavigation";
import type { useWorkshopSession } from "./useWorkshopSession";

function safeBannerImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw, location.origin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.href.replace(/["\\()\r\n]/g, (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, "0")}`);
  } catch {
    return null;
  }
}

export function WorkshopMessages({
  site: home,
  view,
  error,
  errorDetail,
  setError,
  authInviteHint,
  clearAuthInviteHint,
  pendingPolicyUser,
  onOpenPolicy,
  sessionError,
  retrySession,
  loginFallback,
  notice,
  setNotice,
}: {
  site: SiteSettings | null;
  view: ReturnType<typeof useWorkshopNavigation>["view"];
  error: string | null;
  errorDetail?: string | null;
  setError: (message: string | null) => void;
  authInviteHint?: boolean;
  clearAuthInviteHint?: () => void;
  pendingPolicyUser?: MeResponse["user"] | null;
  onOpenPolicy?: () => void;
  sessionError: boolean;
  retrySession: () => void;
  loginFallback: ReturnType<typeof useWorkshopSession>["loginFallback"];
  notice: string | null;
  setNotice: (message: string | null) => void;
}) {
  const { communityInviteUrl, announcement } = parseSiteContent(home);
  const bannerUrl = safeBannerImageUrl(home?.banner?.imageUrl);
  const hasFloatingTop = Boolean(error || sessionError || loginFallback);
  const portalTarget = typeof document !== "undefined" ? document.body : null;

  return (
    <div className="workshop-messages">
      {bannerUrl && home?.banner && view === "browse" ? (
        <div
          className="banner"
          style={
            {
              backgroundImage: `url("${bannerUrl}")`,
              "--banner-x": `${home.banner.positionX}%`,
              "--banner-y": `${home.banner.positionY}%`,
              "--banner-mobile-x": `${home.banner.mobilePositionX ?? home.banner.positionX}%`,
              "--banner-mobile-y": `${home.banner.mobilePositionY ?? home.banner.positionY}%`,
              "--banner-size": home.banner.zoom > 1 ? `${home.banner.zoom * 100}% auto` : "cover",
              "--banner-mobile-size":
                (home.banner.mobileZoom ?? home.banner.zoom) > 1
                  ? `${(home.banner.mobileZoom ?? home.banner.zoom) * 100}% auto`
                  : "cover",
            } as CSSProperties
          }
        />
      ) : null}
      {announcement && view === "browse" ? (
        <section className="site-announcement" aria-label="站点公告">
          <Megaphone aria-hidden="true" />
          <span>{announcement}</span>
        </section>
      ) : null}
      {pendingPolicyUser ? (
        <div className="notice policy-guest-banner" role="status">
          <span className="policy-guest-banner-text">
            <ShieldAlert aria-hidden="true" />
            <span>
              当前以游客身份只读浏览（账号：{pendingPolicyUser.globalName || pendingPolicyUser.username}
              ）。完成使用政策确认与 3 道简短问答后即可点赞、订阅、安装与投稿。
            </span>
          </span>
          {onOpenPolicy ? (
            <button type="button" className="policy-guest-banner-btn" onClick={onOpenPolicy}>
              立即完成确认
            </button>
          ) : null}
        </div>
      ) : null}
      {portalTarget && hasFloatingTop
        ? createPortal(
            <div className="workshop-alert-layer" aria-live="polite" data-workshop-floating-layer="">
              {error ? (
                <div className="error" role="alert">
                  <div className="error-main">
                    <span>{error}</span>
                    {errorDetail ? (
                      <details>
                        <summary>错误详情</summary>
                        <code>{errorDetail}</code>
                      </details>
                    ) : null}
                    {authInviteHint ? (
                      <a
                        className="error-invite-link"
                        href={communityInviteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        尚未加入社区服务器？前往 Discord 社区服务器 →
                      </a>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      clearAuthInviteHint?.();
                    }}
                    aria-label="关闭提示"
                  >
                    ×
                  </button>
                </div>
              ) : null}
              {sessionError ? (
                <p className="error" role="alert">
                  无法恢复登录状态，请检查网络后重试。
                  <button type="button" onClick={retrySession}>
                    重试
                  </button>
                </p>
              ) : null}
              {loginFallback ? (
                <p className="notice">
                  {/* biome-ignore lint/security/noBlankTarget: same-origin OAuth launch page requires window.opener handshake */}
                  <a href={loginFallback} target="_blank" rel="opener">
                    打开 Discord 登录页
                  </a>
                </p>
              ) : null}
            </div>,
            portalTarget,
          )
        : null}
      {portalTarget && notice
        ? createPortal(
            <div className="toast" role="status" aria-live="polite" data-workshop-floating-layer="">
              <span>{notice}</span>
              <button type="button" aria-label="关闭通知" onClick={() => setNotice(null)}>
                <X aria-hidden="true" />
              </button>
            </div>,
            portalTarget,
          )
        : null}
    </div>
  );
}
