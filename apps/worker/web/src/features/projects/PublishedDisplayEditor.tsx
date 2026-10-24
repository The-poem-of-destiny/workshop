import { useEffect, useRef, useState } from "react";
import { ApiError, type AuthorProject, api } from "../../api";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { displayForm, EXTENSION_TYPES, metadataPayload, PROJECT_TYPES, type ProjectForm } from "./projectMetadata";

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
  const [coverNonce, setCoverNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const loadedProject = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    if (loadedProject.current !== entry.project.id) {
      loadedProject.current = entry.project.id;
      dirty.current = false;
      setForm(null);
    }
    api
      .publishedMetadata(entry.project.id)
      .then((metadata) => {
        if (!active) return;
        setRowVersion(metadata.rowVersion);
        setForm((previous) => (dirty.current && previous ? previous : displayForm(metadata)));
      })
      .catch((reason) => {
        if (active && !(reason instanceof ApiError && reason.status === 404)) onError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [entry.project.id, entry.rowVersion]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    api
      .publishedCover(entry.project.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setCover(objectUrl);
      })
      .catch(() => {
        if (active) setCover(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry.project.id, entry.rowVersion, coverNonce]);

  const update = (key: keyof ProjectForm, value: string): void => {
    dirty.current = true;
    setForm((previous) => (previous ? { ...previous, [key]: value } : previous));
  };
  const field = (key: keyof ProjectForm, label: string, multiline = false) => (
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
      onNotice(`公开展示信息已保存（版本 ${result.rowVersion}）。`);
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function uploadCover(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.uploadPublishedCover(entry.project.id, rowVersion, file);
      setRowVersion(result.rowVersion);
      setCoverNonce((value) => value + 1);
      onNotice("当前公开封面已替换。");
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!form) return null;

  return (
    <section className="panel editor">
      <div className="panel-heading">
        <div>
          <h2>当前公开展示</h2>
          <p className="hint">修改公开信息与封面，不改变已发布内容或待审快照 · rowVersion {rowVersion}</p>
        </div>
      </div>
      {cover ? (
        <img className="cover-preview" src={cover} alt="当前公开封面" />
      ) : (
        <p className="hint">当前没有封面。</p>
      )}
      {field("title", "标题")}
      {field("description", "简介", true)}
      {field("authorNote", "作者说明", true)}
      {field("precautions", "安装注意事项", true)}
      <div className="form-grid">
        {field("versionLabel", "版本号")}
        {field("schemaVersion", "适配 schema")}
        {field("discordThreadUrl", "Discord 讨论链接")}
        {field("tags", "标签（逗号分隔）")}
        <label htmlFor="published-project-type">
          项目类型
          <select
            id="published-project-type"
            value={form?.projectType ?? ""}
            disabled={!form || busy}
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
            value={form?.extensionType ?? ""}
            disabled={!form || busy}
            onChange={(event) => update("extensionType", event.target.value)}
          >
            <option value="">不适用</option>
            {EXTENSION_TYPES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {field("coverPositionX", "封面水平位置")}
        {field("coverPositionY", "封面垂直位置")}
        {field("coverZoom", "封面缩放")}
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void save()} disabled={!form || busy}>
          保存公开展示信息
        </button>
        <label className="file-button">
          替换公开封面
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={!form || busy}
            onChange={(event) => void uploadCover(event.target.files?.[0])}
          />
        </label>
      </div>
    </section>
  );
}
