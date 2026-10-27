import { X } from "lucide-react";

import type { CSSProperties } from "react";
import type { HomeResponse } from "./api";
import type { useHostConnection } from "./useHostConnection";
import type { useWorkshopNavigation } from "./useWorkshopNavigation";
import type { useWorkshopSession } from "./useWorkshopSession";

export function WorkshopMessages({
  home,
  view,
  error,
  setError,
  loginFallback,
  notice,
  setNotice,
  installConflicts,
  setInstallConflicts,
}: {
  home: HomeResponse | null;
  view: ReturnType<typeof useWorkshopNavigation>["view"];
  error: string | null;
  setError: (message: string | null) => void;
  loginFallback: ReturnType<typeof useWorkshopSession>["loginFallback"];
  notice: string | null;
  setNotice: (message: string | null) => void;
  installConflicts: ReturnType<typeof useHostConnection>["installConflicts"];
  setInstallConflicts: ReturnType<typeof useHostConnection>["setInstallConflicts"];
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
      {installConflicts ? (
        <section className="conflicts-panel" role="status" aria-label="安装冲突提示">
          <div className="conflicts-panel-head">
            <strong>安装完成，部分条目已保留原有内容</strong>
            <button type="button" aria-label="关闭冲突提示" onClick={() => setInstallConflicts(null)}>
              <X aria-hidden="true" />
            </button>
          </div>
          <p className="conflicts-panel-hint">
            为避免覆盖你在 SillyTavern 中的改动，以下条目未被替换。确认无误后可以手动处理。
          </p>
          <ul>
            {[...new Set(installConflicts)].map((conflict) => (
              <li key={conflict}>{conflict}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
