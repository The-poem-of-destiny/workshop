import type { AuthorProject, ProjectSummary } from "../../api";

export { EXTENSION_TYPES, PROJECT_TYPES } from "@workshop/domain";

export interface ProjectForm {
  title: string;
  description: string;
  authorNote: string;
  precautions: string;
  versionLabel: string;
  projectType: string;
  extensionType: string;
  schemaVersion: string;
  discordThreadUrl: string;
  coverPositionX: string;
  coverPositionY: string;
  coverZoom: string;
  tags: string[];
}

export function projectForm(project: ProjectSummary, entry?: AuthorProject): ProjectForm {
  return {
    title: project.title,
    description: project.description ?? "",
    authorNote: entry?.authorNote ?? project.authorNote ?? "",
    precautions: entry?.precautions ?? "",
    versionLabel: project.versionLabel ?? "",
    projectType: project.projectType ?? "",
    extensionType: project.extensionType ?? "",
    schemaVersion: project.schemaVersion ?? "",
    discordThreadUrl: project.discordThreadUrl ?? "",
    coverPositionX: String(project.coverPositionX ?? 50),
    coverPositionY: String(project.coverPositionY ?? 50),
    coverZoom: String(project.coverZoom ?? 1),
    tags: [...project.tags],
  };
}

export function metadataPayload(form: ProjectForm): Record<string, unknown> {
  return {
    title: form.title,
    description: form.description || null,
    authorNote: form.authorNote || null,
    precautions: form.precautions || null,
    versionLabel: form.versionLabel || null,
    projectType: form.projectType || null,
    extensionType: form.extensionType || null,
    coverPositionX: Number(form.coverPositionX),
    coverPositionY: Number(form.coverPositionY),
    coverZoom: Number(form.coverZoom),
    schemaVersion: form.schemaVersion || null,
    discordThreadUrl: form.discordThreadUrl || null,
    tags: form.tags,
  };
}
