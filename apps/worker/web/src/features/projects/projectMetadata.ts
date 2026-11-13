import type { Requirements } from "@workshop/contracts";
import type { ProjectType } from "@workshop/domain";
import type { AuthorProject, ProjectSummary } from "../../api";

export interface ProjectForm {
  title: string;
  description: string;
  requirements: Requirements;
  versionLabel: string;
  projectType: ProjectType | "";
  includedTypes: ProjectType[];
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
    requirements: entry?.requirements ?? { schemaVersion: 1, dependencies: [], conflicts: [], notes: "" },
    versionLabel: project.versionLabel ?? "",
    projectType: project.projectType,
    includedTypes: [...project.includedTypes],
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
    requirements: form.requirements,
    versionLabel: form.versionLabel || null,
    projectType: form.projectType,
    includedTypes: form.includedTypes,
    coverPositionX: Number(form.coverPositionX),
    coverPositionY: Number(form.coverPositionY),
    coverZoom: Number(form.coverZoom),
    schemaVersion: form.schemaVersion || null,
    discordThreadUrl: form.discordThreadUrl || null,
    tags: form.tags,
  };
}
