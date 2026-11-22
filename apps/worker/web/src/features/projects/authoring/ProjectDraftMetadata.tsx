import { type Dispatch, type SetStateAction, useState } from "react";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import type { ProjectForm } from "../projectMetadata";
import { ProjectClassification } from "./ProjectClassification";
import { RequirementsEditor } from "./RequirementsEditor";
import { TagPicker } from "./TagPicker";

type TextField = Exclude<keyof ProjectForm, "tags" | "requirements" | "projectType" | "includedTypes">;

export function ProjectDraftMetadata({
  form,
  setForm,
  disabled,
}: {
  form: ProjectForm;
  setForm: Dispatch<SetStateAction<ProjectForm>>;
  disabled: boolean;
}) {
  function update(key: TextField, value: string): void {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  const hasRequirements = Boolean(
    form.requirements.notes.trim() ||
      form.requirements.dependencies.length > 0 ||
      form.requirements.conflicts.length > 0 ||
      (form.requirements.recommended && form.requirements.recommended.length > 0),
  );
  const [reqOpen, setReqOpen] = useState(hasRequirements);

  return (
    <section id="editor-sec-basics" className="workspace-section authoring-section authoring-card">
      <h3>① 基础资料与分类标签</h3>
      <div className="form-grid">
        <label htmlFor="title-field">
          标题
          <Input
            id="title-field"
            disabled={disabled}
            value={form.title}
            onChange={(event) => update("title", event.target.value)}
          />
        </label>
        <label htmlFor="versionLabel-field">
          版本号
          <Input
            id="versionLabel-field"
            placeholder="例如 1.0.0"
            disabled={disabled}
            value={form.versionLabel}
            onChange={(event) => update("versionLabel", event.target.value)}
          />
        </label>
      </div>

      <ProjectClassification
        idPrefix="project"
        projectType={form.projectType}
        includedTypes={form.includedTypes}
        disabled={disabled}
        onChange={(projectType, includedTypes) => setForm((previous) => ({ ...previous, projectType, includedTypes }))}
      />

      <div className="editor-subsection">
        <span className="editor-subsection-label">作品标签（最多 20 个）</span>
        <TagPicker
          idPrefix="project"
          value={form.tags}
          projectType={form.projectType}
          disabled={disabled}
          onChange={(tags) => setForm((previous) => ({ ...previous, tags }))}
        />
      </div>

      <label htmlFor="description-field">
        简介（支持 Markdown）
        <Textarea
          id="description-field"
          disabled={disabled}
          value={form.description}
          placeholder="介绍作品设定、使用方法或注意事项…"
          onChange={(event) => update("description", event.target.value)}
        />
      </label>

      <div className="form-grid">
        <label htmlFor="schemaVersion-field">
          适配卡版本（选填）
          <Input
            id="schemaVersion-field"
            placeholder="例如 v4.3，不确定可留空"
            disabled={disabled}
            value={form.schemaVersion}
            onChange={(event) => update("schemaVersion", event.target.value)}
          />
        </label>
        <label htmlFor="discordThreadUrl-field">
          Discord 讨论链接（选填）
          <Input
            id="discordThreadUrl-field"
            placeholder="https://discord.com/channels/..."
            disabled={disabled}
            value={form.discordThreadUrl}
            onChange={(event) => update("discordThreadUrl", event.target.value)}
          />
        </label>
      </div>

      <details className="editor-collapsible" open={reqOpen} onToggle={(event) => setReqOpen(event.currentTarget.open)}>
        <summary>
          前置依赖、冲突与搭配建议（选填
          {hasRequirements
            ? ` · 已填 ${
                form.requirements.dependencies.length +
                form.requirements.conflicts.length +
                (form.requirements.recommended?.length ?? 0)
              } 条`
            : ""}
          ）
        </summary>
        <div className="editor-collapsible-body">
          <RequirementsEditor
            value={form.requirements}
            disabled={disabled}
            onChange={(requirements) => setForm((previous) => ({ ...previous, requirements }))}
          />
        </div>
      </details>
    </section>
  );
}
