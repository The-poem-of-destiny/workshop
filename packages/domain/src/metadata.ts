import { MAX_CUSTOM_TAGS } from "./taxonomy.js";

export const METADATA_CHECKER_REVISION = "metadata-v1";

export const METADATA_LIMITS = {
  title: 200,
  description: 100_000,
  requirementsNotes: 2_000,
  versionLabel: 80,
  tags: MAX_CUSTOM_TAGS,
  tagLength: 100,
  coverPosition: [0, 100],
  coverZoom: [1, 3],
} as const;

export interface MetadataInput {
  title: string;
  description?: string | null;
  requirements?: { notes: string } | null;
  versionLabel?: string | null;
  tags?: string[];
  coverPositionX?: number;
  coverPositionY?: number;
  coverZoom?: number;
}

export interface MetadataFinding {
  field: string;
  severity: "warn" | "block";
  message: string;
}

export interface MetadataInspection {
  gate: "pass" | "warn" | "block";
  findings: MetadataFinding[];
}

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function add(findings: MetadataFinding[], field: string, severity: MetadataFinding["severity"], message: string) {
  findings.push({ field, severity, message });
}

export function inspectProjectMetadata(input: MetadataInput): MetadataInspection {
  const findings: MetadataFinding[] = [];
  if (!input.title.trim()) add(findings, "title", "block", "标题不能为空");
  if (input.title.length > METADATA_LIMITS.title) add(findings, "title", "block", "标题过长");
  if (typeof input.description === "string" && input.description.length > METADATA_LIMITS.description) {
    add(findings, "description", "block", "文本超过长度上限");
  }
  if (input.requirements && input.requirements.notes.length > METADATA_LIMITS.requirementsNotes) {
    add(findings, "requirements", "block", "依赖与冲突说明超过 2000 字符");
  }
  if (typeof input.versionLabel === "string" && input.versionLabel.length > METADATA_LIMITS.versionLabel) {
    add(findings, "versionLabel", "block", "版本标签超过 80 字符");
  }
  for (const [field, value] of Object.entries({
    title: input.title,
    description: input.description,
    requirements: input.requirements?.notes,
    versionLabel: input.versionLabel,
  })) {
    if (typeof value === "string" && CONTROL_CHARACTERS.test(value)) {
      add(findings, field, "block", "包含控制字符");
    }
  }

  const tags = input.tags ?? [];
  if (tags.length > METADATA_LIMITS.tags) add(findings, "tags", "block", "标签数量过多");
  if (tags.some((tag) => !tag.trim() || tag !== tag.trim()))
    add(findings, "tags", "block", "标签不能为空或包含首尾空白");
  if (
    tags.some((tag) => {
      if (tag.length <= METADATA_LIMITS.tagLength) return false;
      let codePoints = 0;
      for (let index = 0; index < tag.length; index += 1) {
        codePoints += 1;
        if (codePoints > METADATA_LIMITS.tagLength) return true;
        if (tag.codePointAt(index)! > 0xffff) index += 1;
      }
      return false;
    })
  ) {
    add(findings, "tags", "block", "单个标签过长");
  }
  if (new Set(tags).size !== tags.length) add(findings, "tags", "block", "存在重复标签");

  for (const [field, value] of [
    ["coverPositionX", input.coverPositionX],
    ["coverPositionY", input.coverPositionY],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100)) {
      add(findings, field, "block", "封面位置必须在 0–100 之间");
    }
  }
  if (
    input.coverZoom !== undefined &&
    (!Number.isFinite(input.coverZoom) || input.coverZoom < 1 || input.coverZoom > 3)
  ) {
    add(findings, "coverZoom", "block", "封面缩放必须在 1–3 之间");
  }

  const gate = findings.some((item) => item.severity === "block") ? "block" : findings.length > 0 ? "warn" : "pass";
  return { gate, findings };
}
