import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { api, formatUserError } from "../../api";
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
      onNotice("草稿已创建，接下来可上传世界书、正则与封面。");
      onCreated(created.project.id);
    } catch (reason) {
      onError(formatUserError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-section workspace-create">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">创作者工作台</p>
          <h2>新建项目</h2>
          <p className="workspace-muted">填写基本资料创建草稿后，即可进入编辑器上传文件与封面。</p>
        </div>
        <button type="button" onClick={cancel} disabled={busy}>
          <ArrowLeft aria-hidden="true" />
          返回我的项目
        </button>
      </div>

      <section className="authoring-section authoring-card">
        <h3>核心资料</h3>
        <div className="workspace-form-grid">
          <label htmlFor="create-title">
            标题
            <Input
              id="create-title"
              placeholder="输入作品名称"
              value={form.title}
              disabled={busy}
              onChange={(event) => update("title", event.target.value)}
            />
          </label>
          <label htmlFor="create-version">
            版本号（选填）
            <Input
              id="create-version"
              placeholder="例如 1.0.0"
              value={form.versionLabel}
              disabled={busy}
              onChange={(event) => update("versionLabel", event.target.value)}
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
        <label htmlFor="create-description">
          作品简介（支持 Markdown）
          <Textarea
            id="create-description"
            placeholder="介绍设定亮点、触发方式或游玩建议…"
            value={form.description}
            disabled={busy}
            onChange={(event) => update("description", event.target.value)}
          />
        </label>
      </section>

      <section className="authoring-section authoring-card">
        <h3>作品标签（选填，最多 20 个）</h3>
        <TagPicker
          idPrefix="create"
          value={form.tags}
          projectType={form.projectType}
          disabled={busy}
          onChange={(tags) => setForm((previous) => ({ ...previous, tags }))}
        />
      </section>

      <details className="authoring-section authoring-card editor-collapsible">
        <summary>进阶选填（适配版本、讨论串、前置依赖与冲突）</summary>
        <div className="editor-collapsible-body">
          <div className="workspace-form-grid">
            <label htmlFor="create-schema">
              适配卡版本（选填）
              <Input
                id="create-schema"
                placeholder="例如 v4.3，不确定可留空"
                value={form.schemaVersion}
                disabled={busy}
                onChange={(event) => update("schemaVersion", event.target.value)}
              />
            </label>
            <label htmlFor="create-discord">
              Discord 讨论链接（选填）
              <Input
                id="create-discord"
                placeholder="https://discord.com/channels/..."
                value={form.discordThreadUrl}
                disabled={busy}
                onChange={(event) => update("discordThreadUrl", event.target.value)}
              />
            </label>
          </div>
          <RequirementsEditor
            value={form.requirements}
            disabled={busy}
            onChange={(requirements) => setForm((previous) => ({ ...previous, requirements }))}
          />
        </div>
      </details>

      <div className="workspace-actions create-footer-actions">
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
