import { DEFAULT_COMMUNITY_INVITE_URL } from "@workshop/domain";
import type { useAdminData } from "./useAdminData";

export function AdminSite({
  busy,
  refresh,
  site,
  uploadBanner,
  banner,
  setBanner,
  communityInviteInput,
  setCommunityInviteInput,
  announcementInput,
  setAnnouncementInput,
  siteText,
  setSiteText,
  saveSite,
}: {
  busy: ReturnType<typeof useAdminData>["busy"];
  refresh: ReturnType<typeof useAdminData>["refresh"];
  site: ReturnType<typeof useAdminData>["site"];
  uploadBanner: ReturnType<typeof useAdminData>["uploadBanner"];
  banner: ReturnType<typeof useAdminData>["banner"];
  setBanner: ReturnType<typeof useAdminData>["setBanner"];
  communityInviteInput: string;
  setCommunityInviteInput: (value: string) => void;
  announcementInput: string;
  setAnnouncementInput: (value: string) => void;
  siteText: ReturnType<typeof useAdminData>["siteText"];
  setSiteText: ReturnType<typeof useAdminData>["setSiteText"];
  saveSite: ReturnType<typeof useAdminData>["saveSite"];
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>站点设置</h2>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          刷新
        </button>
      </div>
      {site ? <p className="hint">Banner、社区邀请链接与站点公告保存后立即生效。</p> : null}
      <h3>顶部横幅 Banner</h3>
      <label className="file-button">
        上传 Banner
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            void uploadBanner(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      <div className="form-grid">
        <label>
          图片地址
          <input
            value={banner.imageUrl ?? ""}
            onChange={(event) => setBanner({ ...banner, imageUrl: event.target.value || null })}
          />
        </label>
        <label>
          缩放
          <input
            type="number"
            min="1"
            max="3"
            step="0.1"
            value={banner.zoom}
            onChange={(event) => setBanner({ ...banner, zoom: Number(event.target.value) })}
          />
        </label>
        <label>
          桌面 X
          <input
            type="number"
            min="0"
            max="100"
            value={banner.positionX}
            onChange={(event) => setBanner({ ...banner, positionX: Number(event.target.value) })}
          />
        </label>
        <label>
          桌面 Y
          <input
            type="number"
            min="0"
            max="100"
            value={banner.positionY}
            onChange={(event) => setBanner({ ...banner, positionY: Number(event.target.value) })}
          />
        </label>
        <label>
          手机 X
          <input
            type="number"
            min="0"
            max="100"
            value={banner.mobilePositionX}
            onChange={(event) => setBanner({ ...banner, mobilePositionX: Number(event.target.value) })}
          />
        </label>
        <label>
          手机 Y
          <input
            type="number"
            min="0"
            max="100"
            value={banner.mobilePositionY}
            onChange={(event) => setBanner({ ...banner, mobilePositionY: Number(event.target.value) })}
          />
        </label>
        <label>
          手机缩放
          <input
            type="number"
            min="1"
            max="3"
            step="0.1"
            value={banner.mobileZoom}
            onChange={(event) => setBanner({ ...banner, mobileZoom: Number(event.target.value) })}
          />
        </label>
      </div>

      <h3>社区指引与站点公告</h3>
      <label>
        社区 Discord 邀请链接（留空则默认使用 {DEFAULT_COMMUNITY_INVITE_URL}）
        <input
          type="url"
          value={communityInviteInput}
          placeholder={DEFAULT_COMMUNITY_INVITE_URL}
          onChange={(event) => setCommunityInviteInput(event.target.value)}
        />
        <small className="hint">
          不在首页显著公开暴露，仅在登录验证失败、点击讨论帖提示及「帮助与常见问题」中低调提供。
        </small>
      </label>
      <label>
        全站顶部提示公告（可选，留空则不显示）
        <textarea
          rows={2}
          maxLength={400}
          value={announcementInput}
          placeholder="例如：工坊政策已更新，首次互动前请完成简短确认问答。"
          onChange={(event) => setAnnouncementInput(event.target.value)}
        />
      </label>
      <details>
        <summary>高级扩展配置（JSON）</summary>
        <label>
          其他扩展字段
          <textarea value={siteText} onChange={(event) => setSiteText(event.target.value)} rows={5} />
        </label>
      </details>

      <button type="button" className="primary" onClick={() => void saveSite()}>
        保存站点设置
      </button>
    </section>
  );
}
