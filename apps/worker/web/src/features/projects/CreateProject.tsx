import { useEffect, useState } from "react";
import { api } from "../../api";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import "../../styles/workspaces.css";
import { TagPicker } from "./authoring/TagPicker";
import { EXTENSION_TYPES, metadataPayload, PROJECT_TYPES, type ProjectForm } from "./projectMetadata";

const emptyForm: ProjectForm = {
  title: "",
  description: "",
  authorNote: "",
  precautions: "",
  versionLabel: "",
  projectType: "事件",
  extensionType: "",
  schemaVersion: "",
  discordThreadUrl: "",
  coverPositionX: "50",
  coverPositionY: "50",
  coverZoom: "1",
  tags: [],
};

export function CreateProject({
  onCreated,
  onCancel,
  onError,
  onNotice,
  onDirtyChange,
}: {
  onCreated: (projectId: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(emptyForm);
  useEffect(() => {
    onDirtyChange?.(dirty || busy);
    const protect = (event: BeforeUnloadEvent): void => {
      if (!dirty && !busy) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => {
      onDirtyChange?.(false);
      window.removeEventListener("beforeunload", protect);
    };
  }, [dirty, busy, onDirtyChange]);
  function cancel(): void {
    if (busy || (dirty && !window.confirm("新项目资料尚未保存，确定放弃？"))) return;
    onDirtyChange?.(false);
    onCancel();
  }
  const update = (key: Exclude<keyof ProjectForm, "tags">, value: string): void =>
    setForm((previous) => ({ ...previous, [key]: value }));

  async function create(): Promise<void> {
    if (!form.title.trim() || busy) return;
    setBusy(true);
    try {
      const created = await api.createProject(metadataPayload({ ...form, title: form.title.trim() }));
      onDirtyChange?.(false);
      onNotice("项目草稿已创建，可以开始上传内容文件。");
      onCreated(created.project.id);
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-section workspace-create">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">作者工作区</p>
          <h2>新建项目</h2>
          <p className="workspace-muted">先创建草稿，再在编辑器中上传世界书、正则和封面。</p>
        </div>
        <button type="button" onClick={cancel} disabled={busy}>
          返回我的项目
        </button>
      </div>

      <section className="authoring-section">
        <h3>基本资料</h3>
        <div className="workspace-form-grid">
          <label htmlFor="create-title">
            标题
            <Input
              id="create-title"
              value={form.title}
              disabled={busy}
              onChange={(event) => update("title", event.target.value)}
            />
          </label>
          <label htmlFor="create-version">
            版本号
            <Input
              id="create-version"
              value={form.versionLabel}
              disabled={busy}
              onChange={(event) => update("versionLabel", event.target.value)}
            />
          </label>
          <label htmlFor="create-project-type">
            项目类型
            <select
              id="create-project-type"
              value={form.projectType}
              disabled={busy}
              onChange={(event) => update("projectType", event.target.value)}
            >
              {PROJECT_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label htmlFor="create-extension-type">
            扩展类型
            <select
              id="create-extension-type"
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
          <label htmlFor="create-schema">
            适配 schema
            <Input
              id="create-schema"
              value={form.schemaVersion}
              disabled={busy}
              onChange={(event) => update("schemaVersion", event.target.value)}
            />
            <small className="field-hint">
              填写世界书适配的 schema 版本，例如角色卡 v2；不确定可以留空，检查报告会提示不匹配的地方。
            </small>
          </label>
          <label htmlFor="create-discord">
            Discord 讨论链接
            <Input
              id="create-discord"
              value={form.discordThreadUrl}
              disabled={busy}
              onChange={(event) => update("discordThreadUrl", event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="authoring-section">
        <h3>分类与标签</h3>
        <p className="field-hint">标签会显示在项目页上；角色项目还能从官方标签组中挑选。</p>
        <TagPicker
          idPrefix="create"
          value={form.tags}
          projectType={form.projectType}
          disabled={busy}
          onChange={(tags) => setForm((previous) => ({ ...previous, tags }))}
        />
      </section>

      <section className="authoring-section">
        <h3>说明</h3>
        <label htmlFor="create-description">
          简介
          <Textarea
            id="create-description"
            value={form.description}
            disabled={busy}
            onChange={(event) => update("description", event.target.value)}
          />
        </label>
        <label htmlFor="create-author-note">
          作者说明
          <Textarea
            id="create-author-note"
            value={form.authorNote}
            disabled={busy}
            onChange={(event) => update("authorNote", event.target.value)}
          />
        </label>
        <label htmlFor="create-precautions">
          注意事项
          <Textarea
            id="create-precautions"
            value={form.precautions}
            disabled={busy}
            onChange={(event) => update("precautions", event.target.value)}
          />
          <small className="field-hint">写给读者的提醒，例如推荐设置、可能的触发内容或兼容性说明。</small>
        </label>
      </section>

      <div className="workspace-actions">
        <button type="button" onClick={cancel} disabled={busy}>
          取消
        </button>
        <button
          type="button"
          className="workspace-primary"
          onClick={() => void create()}
          disabled={busy || !form.title.trim()}
        >
          {busy ? "创建中…" : "创建草稿"}
        </button>
      </div>
    </section>
  );
}
