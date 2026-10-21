import { PROJECT_TYPES, type ProjectType, resolveProjectType } from "./taxonomy.js";

export const PROJECT_BASE_TAGS = PROJECT_TYPES;
export type ProjectBaseTag = ProjectType;
export type ProjectEntryKind = "worldbook" | "regex";
export type ProjectContentPresence = Record<ProjectEntryKind, boolean>;

interface ProjectContentRule {
  required: readonly ProjectEntryKind[];
  anyOf: readonly ProjectEntryKind[];
}

/**
 * Gameplay/content policy. File-format validity belongs in the content parser;
 * this table only answers which entry kinds a project type must carry.
 */
export const PROJECT_CONTENT_POLICY: Record<ProjectType, ProjectContentRule> = {
  系统核心: { required: ["worldbook"], anyOf: [] },
  角色: { required: ["worldbook"], anyOf: [] },
  事件: { required: ["worldbook"], anyOf: [] },
  扩展: { required: [], anyOf: ["worldbook", "regex"] },
};

type ProjectContentIdentity =
  | readonly string[]
  | {
      projectType?: unknown;
      project_type?: unknown;
      tags?: readonly string[] | null;
    }
  | null
  | undefined;

export function resolveProjectBaseTag(input: ProjectContentIdentity): ProjectType {
  if (Array.isArray(input)) return resolveProjectType(undefined, input);
  if (!input || typeof input !== "object") return "系统核心";
  const identity = input as Exclude<ProjectContentIdentity, readonly string[] | null | undefined>;
  return resolveProjectType(identity.projectType ?? identity.project_type, identity.tags);
}

export type ProjectContentPolicyValidation =
  | { valid: true; baseTag: ProjectType }
  | { valid: false; baseTag: ProjectType; error: string };

export function validateProjectContentPolicy(
  input: ProjectContentIdentity,
  presence: ProjectContentPresence,
): ProjectContentPolicyValidation {
  const baseTag = resolveProjectBaseTag(input);
  const rule = PROJECT_CONTENT_POLICY[baseTag];

  for (const kind of rule.required) {
    if (!presence[kind]) {
      return { valid: false, baseTag, error: `${baseTag}项目必须包含有效世界书` };
    }
  }

  if (rule.anyOf.length > 0 && !rule.anyOf.some((kind) => presence[kind])) {
    return { valid: false, baseTag, error: `${baseTag}项目必须包含有效世界书或正则` };
  }

  return { valid: true, baseTag };
}
