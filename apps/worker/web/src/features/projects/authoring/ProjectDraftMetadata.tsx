import type { Dispatch, SetStateAction } from "react";
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

  const input = (key: TextField, label: string, multiline = false) =>
    multiline ? (
      <label htmlFor={`${key}-field`}>
        {label}
        <Textarea
          id={`${key}-field`}
          disabled={disabled}
          value={form[key]}
          onChange={(event) => update(key, event.target.value)}
        />
      </label>
    ) : (
      <label htmlFor={`${key}-field`}>
        {label}
        <Input
          id={`${key}-field`}
          disabled={disabled}
          value={form[key]}
          onChange={(event) => update(key, event.target.value)}
        />
      </label>
    );

  return (
    <>
      <section className="workspace-section authoring-section">
        <h3>基本资料</h3>
        {input("title", "标题")}
        {input("description", "简介", true)}
        <RequirementsEditor
          value={form.requirements}
          disabled={disabled}
          onChange={(requirements) => setForm((previous) => ({ ...previous, requirements }))}
        />
        <div className="form-grid">
          <label htmlFor="schemaVersion-field">
            适配 schema
            <Input
              id="schemaVersion-field"
              disabled={disabled}
              value={form.schemaVersion}
              onChange={(event) => update("schemaVersion", event.target.value)}
            />
            <small className="field-hint">填写世界书适配的 schema 版本，例如角色卡 v2；不确定可以留空。</small>
          </label>
          {input("discordThreadUrl", "Discord 讨论链接")}
        </div>
        <div className="form-grid">
          {input("versionLabel", "版本号")}
        </div>
        <ProjectClassification
          idPrefix="project"
          projectType={form.projectType}
          includedTypes={form.includedTypes}
          disabled={disabled}
          onChange={(projectType, includedTypes) => setForm((previous) => ({ ...previous, projectType, includedTypes }))}
        />
        <div className="form-grid">
          {input("coverPositionX", "封面横向位置（0–100）")}
          {input("coverPositionY", "封面纵向位置（0–100）")}
          {input("coverZoom", "封面缩放（1–3）")}
        </div>
      </section>

      <section className="workspace-section authoring-section">
        <h3>分类与标签</h3>
        <p className="field-hint">所有分类的标签组都可使用；主要分类相关的组优先展示，普通标签最多 20 个。</p>
        <TagPicker
          idPrefix="project"
          value={form.tags}
          projectType={form.projectType}
          disabled={disabled}
          onChange={(tags) => setForm((previous) => ({ ...previous, tags }))}
        />
      </section>
    </>
  );
}
