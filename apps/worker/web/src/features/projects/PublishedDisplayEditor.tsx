import { useEffect, useRef, useState } from "react";
import { ApiError, type AuthorProject, api } from "../../api";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import "../../styles/workspaces.css";
import { ImagePicker } from "./authoring/ImagePicker";
import { TagPicker } from "./authoring/TagPicker";
import { readImageInfo, usePendingImage } from "./authoring/usePendingImage";
import { displayForm, EXTENSION_TYPES, metadataPayload, PROJECT_TYPES, type ProjectForm } from "./projectMetadata";

type GalleryImage = { slot: number; url: string };
type TextField = Exclude<keyof ProjectForm, "tags">;

export function PublishedDisplayEditor({
  entry,
  onRefresh,
  onError,
  onNotice,
}: {
  entry: AuthorProject;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [form, setForm] = useState<ProjectForm | null>(null);
  const [rowVersion, setRowVersion] = useState(entry.rowVersion);
  const [cover, setCover] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [coverNonce, setCoverNonce] = useState(0);
  const [galleryNonce, setGalleryNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const loadedProject = useRef<string | null>(null);
  const pendingCover = usePendingImage();

  const metadataRequest = useRef<{ rowVersion: number } | null>(null);
  const coverRequest = useRef<{ rowVersion: number; generation: number } | null>(null);
  const galleryRequest = useRef<{ rowVersion: number; generation: number } | null>(null);
  useEffect(() => {
    let active = true;
    const request = { rowVersion: entry.rowVersion };
    metadataRequest.current = request;
    if (loadedProject.current !== entry.project.id) {
      loadedProject.current = entry.project.id;
      dirty.current = false;
      setForm(null);
      setGallery([]);
    }
    api
      .publishedMetadata(entry.project.id)
      .then((metadata) => {
        if (!active || metadataRequest.current !== request) return;
        setRowVersion(metadata.rowVersion);
        setForm((previous) => (dirty.current && previous ? previous : displayForm(metadata)));
      })
      .catch((reason) => {
        if (active && metadataRequest.current === request && !(reason instanceof ApiError && reason.status === 404)) {
          onError(String(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [entry.project.id, entry.rowVersion, onError]);

  useEffect(() => {
    let active = true;
    const request = { rowVersion: entry.rowVersion, generation: coverNonce };
    coverRequest.current = request;
    let objectUrl: string | null = null;
    api
      .publishedCover(entry.project.id)
      .then((blob) => {
        if (!active || coverRequest.current !== request) return;
        objectUrl = URL.createObjectURL(blob);
        setCover(objectUrl);
      })
      .catch(() => {
        if (active && coverRequest.current === request) setCover(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry.project.id, entry.rowVersion, coverNonce]);

  useEffect(() => {
    let active = true;
    const request = { rowVersion: entry.rowVersion, generation: galleryNonce };
    galleryRequest.current = request;
    const objectUrls: string[] = [];
    setGallery([]);
    api
      .projectGallery(entry.project.id)
      .then(async (result) => {
        const images = await Promise.all(
          result.images.map(async (image) => {
            const blob = await api.galleryImage(image.url);
            if (!active || galleryRequest.current !== request) return null;
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            return { slot: image.slot, url };
          }),
        );
        if (active && galleryRequest.current === request) {
          setGallery(images.filter((image): image is GalleryImage => image !== null));
          setRowVersion(result.rowVersion);
        }
      })
      .catch((reason) => {
        if (active && galleryRequest.current === request) onError(String(reason));
      });
    return () => {
      active = false;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [entry.project.id, entry.rowVersion, galleryNonce, onError]);

  const update = (key: TextField, value: string): void => {
    dirty.current = true;
    setForm((previous) => (previous ? { ...previous, [key]: value } : previous));
  };
  const field = (key: TextField, label: string, multiline = false) => (
    <label htmlFor={`published-${key}-field`}>
      {label}
      {multiline ? (
        <Textarea
          id={`published-${key}-field`}
          value={form?.[key] ?? ""}
          disabled={!form || busy}
          onChange={(event) => update(key, event.target.value)}
        />
      ) : (
        <Input
          id={`published-${key}-field`}
          value={form?.[key] ?? ""}
          disabled={!form || busy}
          onChange={(event) => update(key, event.target.value)}
        />
      )}
    </label>
  );

  async function save(): Promise<void> {
    if (!form) return;
    setBusy(true);
    try {
      const result = await api.patchPublishedMetadata(entry.project.id, rowVersion, metadataPayload(form));
      setRowVersion(result.rowVersion);
      dirty.current = false;
      onNotice("公开展示信息已保存。");
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function uploadCover(): Promise<void> {
    const pending = pendingCover.pending;
    if (!pending) return;
    setBusy(true);
    try {
      const result = await api.uploadPublishedCover(entry.project.id, rowVersion, pending.file);
      setRowVersion(result.rowVersion);
      pendingCover.clear();
      setCoverNonce((value) => value + 1);
      onNotice("当前公开封面已替换。");
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function uploadGallery(slot: number, file: File | undefined): Promise<void> {
    if (!file) return;
    const info = await readImageInfo(file);
    if (!info.ok) {
      onError(info.error);
      return;
    }
    setBusy(true);
    try {
      const result = await api.uploadGalleryImage(entry.project.id, slot, rowVersion, file);
      setRowVersion(result.rowVersion);
      setGalleryNonce((value) => value + 1);
      onNotice(`公开展示图片 ${slot + 1} 已上传。`);
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteGallery(slot: number): Promise<void> {
    if (!window.confirm(`确定删除公开展示图片 ${slot + 1}？`)) return;
    setBusy(true);
    try {
      const result = await api.deleteGalleryImage(entry.project.id, slot, rowVersion);
      setRowVersion(result.rowVersion);
      setGalleryNonce((value) => value + 1);
      onNotice(`公开展示图片 ${slot + 1} 已删除。`);
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!form) return null;

  return (
    <section className="workspace-section editor workspace-published-editor">
      <div className="workspace-heading">
        <div>
          <h2>当前公开展示</h2>
          <p className="workspace-muted">修改公开信息与图片，不改变已发布内容或待审快照。</p>
        </div>
      </div>
      <section className="authoring-section">
        <h3>公开展示资料</h3>
        {field("title", "标题")}
        {field("description", "简介", true)}
        {field("authorNote", "作者说明", true)}
        {field("precautions", "安装注意事项", true)}
        <div className="workspace-form-grid">
          {field("versionLabel", "版本号")}
          <label htmlFor="published-schema">
            适配 schema
            <Input
              id="published-schema"
              value={form.schemaVersion}
              disabled={busy}
              onChange={(event) => update("schemaVersion", event.target.value)}
            />
            <small className="field-hint">填写世界书适配的 schema 版本，例如角色卡 v2；不确定可以留空。</small>
          </label>
          {field("discordThreadUrl", "Discord 讨论链接")}
          <label htmlFor="published-project-type">
            项目类型
            <select
              id="published-project-type"
              value={form.projectType}
              disabled={busy}
              onChange={(event) => update("projectType", event.target.value)}
            >
              <option value="">请选择</option>
              {PROJECT_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label htmlFor="published-extension-type">
            扩展类型
            <select
              id="published-extension-type"
              value={form.extensionType}
              disabled={busy}
              onChange={(event) => update("extensionType", event.target.value)}
            >
              <option value="">不适用</option>
              {EXTENSION_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="authoring-section">
        <h3>分类与标签</h3>
        <TagPicker
          idPrefix="published"
          value={form.tags}
          projectType={form.projectType}
          disabled={busy}
          onChange={(tags) => {
            dirty.current = true;
            setForm((previous) => (previous ? { ...previous, tags } : previous));
          }}
        />
      </section>

      <section className="authoring-section">
        <h3>公开展示封面</h3>
        <ImagePicker
          id="published-cover-file"
          label="选择公开封面"
          uploadLabel={cover ? "替换公开封面" : "上传公开封面"}
          hint="JPEG、PNG 或 WebP，单张不超过 5 MiB，宽高不超过 4096 像素。选择后可以先预览再上传。"
          disabled={busy}
          currentUrl={cover}
          currentAlt="当前公开封面"
          pending={pendingCover.pending}
          error={pendingCover.error}
          onPick={(file) => void pendingCover.pick(file)}
          onClear={pendingCover.clear}
          onUpload={() => void uploadCover()}
        />
        <div className="workspace-form-grid">
          {field("coverPositionX", "封面水平位置")}
          {field("coverPositionY", "封面垂直位置")}
          {field("coverZoom", "封面缩放")}
        </div>
      </section>

      <div className="workspace-gallery">
        <div>
          <h3>公开展示图片</h3>
          <p className="workspace-muted">最多添加 2 张额外图片，不包含上方封面。</p>
        </div>
        <div className="workspace-gallery-grid">
          {[0, 1].map((slot) => {
            const image = gallery.find((item) => item.slot === slot);
            return (
              <div className="workspace-gallery-slot" key={slot}>
                {image ? <img src={image.url} alt={`公开展示图片 ${slot + 1}`} /> : <span>空槽位</span>}
                <div className="workspace-gallery-actions">
                  <label className="file-button">
                    {image ? "替换图片" : "上传图片"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={busy}
                      onChange={(event) => void uploadGallery(slot, event.target.files?.[0])}
                    />
                  </label>
                  {image ? (
                    <button type="button" onClick={() => void deleteGallery(slot)} disabled={busy}>
                      删除
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <p className="workspace-upload-hint">JPEG、PNG 或 WebP，单张不超过 5 MiB，宽高不超过 4096 像素。</p>
      </div>
      <div className="actions workspace-actions">
        <button type="button" className="primary workspace-primary" onClick={() => void save()} disabled={busy}>
          保存公开展示信息
        </button>
      </div>
    </section>
  );
}
