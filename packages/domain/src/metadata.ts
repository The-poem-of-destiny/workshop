export const METADATA_CHECKER_REVISION = "metadata-v1";

export const METADATA_LIMITS = {
  title: 200,
  description: 100_000,
  authorNote: 100_000,
  precautions: 2_000,
  versionLabel: 80,
  tags: 100,
  tagLength: 100,
  coverPosition: [0, 100],
  coverZoom: [1, 3],
} as const;

export interface MetadataInput {
  title: string;
  description?: string | null;
  authorNote?: string | null;
  precautions?: string | null;
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
  for (const field of ["description", "authorNote"] as const) {
    const value = input[field];
    if (typeof value === "string" && value.length > METADATA_LIMITS[field]) {
      add(findings, field, "block", "文本超过长度上限");
    }
  }
  if (typeof input.precautions === "string" && input.precautions.length > METADATA_LIMITS.precautions) {
    add(findings, "precautions", "block", "安装注意事项超过 2000 字符");
  }
  if (typeof input.versionLabel === "string" && input.versionLabel.length > METADATA_LIMITS.versionLabel) {
    add(findings, "versionLabel", "block", "版本标签超过 80 字符");
  }
  for (const [field, value] of Object.entries({
    title: input.title,
    description: input.description,
    authorNote: input.authorNote,
    precautions: input.precautions,
    versionLabel: input.versionLabel,
  })) {
    if (typeof value === "string" && CONTROL_CHARACTERS.test(value)) {
      add(findings, field, "block", "包含控制字符");
    }
  }

  const tags = input.tags ?? [];
  if (tags.length > METADATA_LIMITS.tags) add(findings, "tags", "block", "标签数量过多");
  if (tags.some((tag) => tag.length > METADATA_LIMITS.tagLength)) add(findings, "tags", "block", "单个标签过长");
  if (new Set(tags).size !== tags.length) add(findings, "tags", "warn", "存在重复标签");

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
