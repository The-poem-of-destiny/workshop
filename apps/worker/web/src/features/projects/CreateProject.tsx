import { useEffect, useState } from "react";
import { api } from "../../api";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import "../../styles/workspaces.css";
import { ProjectClassification } from "./authoring/ProjectClassification";
import { RequirementsEditor } from "./authoring/RequirementsEditor";
import { TagPicker } from "./authoring/TagPicker";
import { metadataPayload, type ProjectForm } from "./projectMetadata";

const emptyForm: ProjectForm = {
  title: "",
  description: "",
  requirements: { schemaVersion: 1, dependencies: [], conflicts: [], notes: "" },
  versionLabel: "",
  projectType: "",
  includedTypes: [],
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
  const update = (
    key: Exclude<keyof ProjectForm, "tags" | "requirements" | "projectType" | "includedTypes">,
    value: string,
  ): void => setForm((previous) => ({ ...previous, [key]: value }));

  async function create(): Promise<void> {
    if (!form.title.trim() || !form.projectType || busy) return;
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
        <ProjectClassification
          idPrefix="create"
          projectType={form.projectType}
          includedTypes={form.includedTypes}
          disabled={busy}
          onChange={(projectType, includedTypes) =>
            setForm((previous) => ({ ...previous, projectType, includedTypes }))
          }
        />
      </section>

      <section className="authoring-section">
        <h3>分类与标签</h3>
        <p className="field-hint">所有分类都可选用下方标签；主要分类相关的标签组优先展示，普通标签最多 20 个。</p>
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
        <RequirementsEditor
          value={form.requirements}
          disabled={busy}
          onChange={(requirements) => setForm((previous) => ({ ...previous, requirements }))}
        />
      </section>

      <div className="workspace-actions">
        <button type="button" onClick={cancel} disabled={busy}>
          取消
        </button>
        <button
          type="button"
          className="workspace-primary"
          onClick={() => void create()}
          disabled={busy || !form.title.trim() || !form.projectType}
        >
          {busy ? "创建中…" : "创建草稿"}
        </button>
      </div>
    </section>
  );
}
