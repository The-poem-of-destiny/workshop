import type { useAdminData } from "./useAdminData";

export function AdminSite({
  busy,
  refresh,
  site,
  uploadBanner,
  banner,
  setBanner,
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
      {site ? <p className="hint">Banner 与站点文案写入 `site_settings`，保存即生效。</p> : null}
      <h3>Banner</h3>
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
      <label>
        站点内容 JSON
        <textarea value={siteText} onChange={(event) => setSiteText(event.target.value)} rows={8} />
      </label>
      <button type="button" className="primary" onClick={() => void saveSite()}>
        保存站点设置
      </button>
    </section>
  );
}
