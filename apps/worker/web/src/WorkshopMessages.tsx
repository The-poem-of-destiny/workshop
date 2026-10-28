import { X } from "lucide-react";

import type { CSSProperties } from "react";
import type { SiteSettings } from "./api";
import type { useWorkshopNavigation } from "./useWorkshopNavigation";
import type { useWorkshopSession } from "./useWorkshopSession";

export function WorkshopMessages({
  site: home,
  view,
  error,
  setError,
  loginFallback,
  notice,
  setNotice,
}: {
  site: SiteSettings | null;
  view: ReturnType<typeof useWorkshopNavigation>["view"];
  error: string | null;
  setError: (message: string | null) => void;
  loginFallback: ReturnType<typeof useWorkshopSession>["loginFallback"];
  notice: string | null;
  setNotice: (message: string | null) => void;
}) {
  return (
    <>
      {home?.banner?.imageUrl && view === "browse" ? (
        <div
          className="banner"
          style={
            {
              backgroundImage: `url(${home.banner.imageUrl})`,
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
      {error ? (
        <p className="error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="关闭提示">
            ×
          </button>
        </p>
      ) : null}
      {loginFallback ? (
        <p className="notice">
          <a href={loginFallback} target="_blank" rel="noopener opener">
            打开 Discord 登录页
          </a>
        </p>
      ) : null}
      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="关闭通知" onClick={() => setNotice(null)}>
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}
