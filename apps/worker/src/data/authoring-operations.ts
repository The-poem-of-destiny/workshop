import { projectEntryIndexDocumentSchema, projectTaxonomySchema } from "@workshop/contracts";
import { inspectProjectMetadata } from "@workshop/domain";
import {
  createProject,
  getLatestProjectSubmission,
  getProjectSummary,
  softDeleteProject,
  updateVisibility,
} from "../storage/authoring.js";
import { deleteProjectEntry } from "../storage/authoring-assets.js";
import { getAuthoringProject, parseIncludedTypes, parseRequirements, parseTags } from "../storage/authoring-model.js";
import { submitVersion, withdrawSubmission } from "../storage/authoring-submissions.js";
import {
  countRecentMetadataMutations,
  createVersion,
  getSubmissionBaselineForVersion,
  listVersionsChangeEvidenceRows,
  patchProject,
} from "../storage/authoring-versions.js";
import { listAuthorCollectionIdsByProjects } from "../storage/collections.js";
import { deleteGalleryImage, getAuthorGallery } from "../storage/project-gallery.js";
import { getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env.js";
import { replicatePublicCover, withdrawPublicCover } from "./public-covers";
import { replicatePublicGallery, withdrawPublicGallery } from "./public-gallery";

async function author(env: DataEnv, authorization: string | undefined) {
  const session = authorization?.startsWith("Bearer ")
    ? await getSessionByToken(env.DB, authorization.slice(7), env.SESSION_HASH_SECRET)
    : null;
  if (!session) return { kind: "unauthorized" as const };
  if (!session.policyAccepted) return { kind: "forbidden" as const };
  return { kind: "ok" as const, session };
}

export async function authorCreateProject(
  env: DataEnv,
  authorization: string | undefined,
  input: Parameters<typeof createProject>[2],
) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await createProject(env.DB, auth.session, input) };
}

export async function authorGetDraft(env: DataEnv, authorization: string | undefined, id: string) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  const project = await getAuthoringProject(env.DB, id, auth.session);
  if (!project) return { kind: "not_found" as const };
  const summary = await getProjectSummary(env.DB, project.id);
  if (!summary) return { kind: "not_found" as const };
  const [latestSubmission, collectionMap] = await Promise.all([
    getLatestProjectSubmission(env.DB, project.id),
    listAuthorCollectionIdsByProjects(env.DB, [project.id]),
  ]);
  return {
    kind: "ok" as const,
    data: {
      project: summary,
      rowVersion: project.row_version,
      workingVersionId: project.working_version_id,
      latestSubmission: latestSubmission ?? null,
      collectionIds: collectionMap.get(project.id) ?? [],
    },
  };
}

export async function authorDeleteEntry(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  versionId: string,
  kind: "worldbook" | "regex",
  entryKey: string,
  expectedVersion: number,
) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  return {
    kind: "ok" as const,
    data: await deleteProjectEntry(env.DB, env.R2, auth.session, projectId, versionId, kind, entryKey, expectedVersion),
  };
}

export async function authorGetGallery(env: DataEnv, authorization: string | undefined, projectId: string) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  return { kind: "ok" as const, data: await getAuthorGallery(env.DB, projectId, auth.session) };
}

export async function authorDeleteGallery(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  slot: number,
  expectedVersion: number | null,
) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  const project = await getAuthoringProject(env.DB, projectId, auth.session);
  if (!project) return { kind: "not_found" as const };
  if (expectedVersion === null) return { kind: "version_conflict" as const, actual: project.row_version };
  const result = await deleteGalleryImage(env.DB, auth.session, project.id, slot, expectedVersion, () =>
    withdrawPublicGallery(env, project.id, slot, expectedVersion),
  );
  if (result.kind === "conflict") {
    const latest = await getAuthoringProject(env.DB, project.id, auth.session);
    return { kind: "version_conflict" as const, actual: latest?.row_version ?? project.row_version };
  }
  return { kind: "ok" as const, data: result };
}

export async function refreshPublicProjectImages(env: DataEnv, projectId: string): Promise<void> {
  const results = await Promise.allSettled([
    replicatePublicCover(env, projectId),
    replicatePublicGallery(env, projectId),
  ]);
  for (const result of results) {
    if (result.status === "rejected") console.warn("Public image copy failed after project update", result.reason);
  }
}

function isPublicImageWithdrawalPending(error: unknown): boolean {
  return error instanceof Error && /public_(cover|gallery)_withdrawal_pending/.test(error.message);
}

export async function authorDeleteProject(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  expectedVersion: number | null,
) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  const project = await getAuthoringProject(env.DB, projectId, auth.session);
  if (!project) return { kind: "not_found" as const };
  if (expectedVersion === null || expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  if (
    !(await withdrawPublicCover(env, project.id)) ||
    !(await withdrawPublicGallery(env, project.id, undefined, expectedVersion))
  )
    return { kind: "withdrawal_pending" as const };
  try {
    if (!(await softDeleteProject(env.DB, auth.session, project.id, expectedVersion)))
      return { kind: "version_conflict" as const, actual: project.row_version };
  } catch (error) {
    if (isPublicImageWithdrawalPending(error)) return { kind: "withdrawal_pending" as const };
    throw error;
  }
  return { kind: "ok" as const };
}

export async function authorUpdateVisibility(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  expectedVersion: number | null,
  input: Parameters<typeof updateVisibility>[4],
) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  const project = await getAuthoringProject(env.DB, projectId, auth.session);
  if (!project) return { kind: "not_found" as const };
  if (expectedVersion === null || expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  if (input.visibility !== "public") {
    if (
      !(await withdrawPublicCover(env, project.id)) ||
      !(await withdrawPublicGallery(env, project.id, undefined, expectedVersion))
    )
      return { kind: "withdrawal_pending" as const };
  }
  let rowVersion: Awaited<ReturnType<typeof updateVisibility>>;
  try {
    rowVersion = await updateVisibility(env.DB, auth.session, project.id, expectedVersion, input);
  } catch (error) {
    if (isPublicImageWithdrawalPending(error)) return { kind: "withdrawal_pending" as const };
    throw error;
  }
  if (!rowVersion) return { kind: "version_conflict" as const, actual: project.row_version };
  if (input.visibility === "public") await refreshPublicProjectImages(env, project.id);
  return { kind: "ok" as const, rowVersion };
}

async function authorEditMetadata(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  expectedVersion: number | null,
  input: Parameters<typeof patchProject>[4],
  revision: boolean,
) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  const { session } = auth;
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return { kind: "not_found" as const };
  if (expectedVersion === null || expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  if (!revision && project.working_version_frozen) return { kind: "frozen" as const };
  const taxonomy = projectTaxonomySchema.safeParse({
    projectType: input.projectType ?? project.project_type,
    includedTypes: input.includedTypes ?? parseIncludedTypes(project.included_types),
  });
  if (!taxonomy.success) {
    return {
      kind: "invalid_metadata" as const,
      findings: taxonomy.error.issues.map((issue) => ({
        field: issue.path.join("."),
        severity: "block" as const,
        message: issue.message,
      })),
    };
  }
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  if ((await countRecentMetadataMutations(env.DB, project.id, session.userId, cutoff)) >= 20) {
    return { kind: "rate_limited" as const };
  }
  const metadata = inspectProjectMetadata({
    title: input.title ?? project.title,
    description: input.description !== undefined ? input.description : project.description,
    requirements: input.requirements !== undefined ? input.requirements : parseRequirements(project.requirements),
    versionLabel: input.versionLabel !== undefined ? input.versionLabel : project.version_label,
    tags: input.tags ?? parseTags(project.search_tags),
    coverPositionX: input.coverPositionX ?? project.cover_position_x,
    coverPositionY: input.coverPositionY ?? project.cover_position_y,
    coverZoom: input.coverZoom ?? project.cover_zoom,
  });
  if (metadata.gate === "block") return { kind: "invalid_metadata" as const, findings: metadata.findings };
  const result = revision
    ? await createVersion(env.DB, session, project.id, expectedVersion, input)
    : await patchProject(env.DB, session, project.id, expectedVersion, input);
  if (!result) return { kind: "cas_conflict" as const, actual: project.row_version };
  return { kind: "ok" as const, data: result };
}

export function authorPatchProject(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  expectedVersion: number | null,
  input: Parameters<typeof patchProject>[4],
) {
  return authorEditMetadata(env, authorization, projectId, expectedVersion, input, false);
}

export function authorCreateVersion(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  expectedVersion: number | null,
  input: Parameters<typeof patchProject>[4],
) {
  return authorEditMetadata(env, authorization, projectId, expectedVersion, input, true);
}

export async function authorSubmit(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  versionId: string,
  expectedVersion: number,
  input: Parameters<typeof submitVersion>[6],
  prevalidated: Parameters<typeof submitVersion>[7],
) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  const { session } = auth;
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return { kind: "not_found" as const, message: "Project not found" };
  if (expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  if (project.working_version_id !== versionId)
    return { kind: "not_found" as const, message: "Working revision not found" };
  if (project.working_version_frozen)
    return { kind: "conflict" as const, message: "Revision is already submitted; create a new revision" };
  const result = await submitVersion(
    env.DB,
    session,
    project.id,
    versionId,
    expectedVersion,
    project.published_version_id,
    input,
    prevalidated,
  );
  if (!result.ok) {
    if (result.code === "conflict") {
      const latest = await getAuthoringProject(env.DB, project.id, session);
      if (latest && latest.row_version !== expectedVersion)
        return { kind: "version_conflict" as const, actual: latest.row_version };
    }
    return { kind: "error" as const, code: result.code, message: result.message };
  }
  return { kind: "ok" as const, data: result };
}

export async function authorWithdraw(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  submissionId: string,
  expectedVersion: number,
) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  const { session } = auth;
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (!project) return { kind: "not_found" as const };
  if (expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  const result = await withdrawSubmission(env.DB, session, project.id, submissionId, expectedVersion);
  return { kind: "ok" as const, data: result };
}

export async function authorPrepareSubmission(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  versionId: string,
  expectedVersion: number,
) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  const project = await getAuthoringProject(env.DB, projectId, auth.session);
  if (!project) return { kind: "not_found" as const, message: "Project not found" };
  if (expectedVersion !== project.row_version)
    return { kind: "version_conflict" as const, actual: project.row_version };
  if (project.working_version_id !== versionId)
    return { kind: "not_found" as const, message: "Working revision not found" };
  if (project.working_version_frozen)
    return { kind: "conflict" as const, message: "Revision is already submitted; create a new revision" };
  return { kind: "ok" as const };
}

export async function authorChangeEvidence(
  env: DataEnv,
  authorization: string | undefined,
  projectId: string,
  versionId: string,
) {
  const auth = await author(env, authorization);
  if (auth.kind !== "ok") return auth;
  const { session } = auth;
  const project = await getAuthoringProject(env.DB, projectId, session);
  if (
    !project ||
    project.author_id !== session.userId ||
    (project.working_version_id !== versionId && project.published_version_id !== versionId)
  )
    return { kind: "not_found" as const };
  const baselineVersionId = await getSubmissionBaselineForVersion(env.DB, projectId, versionId);
  if (!baselineVersionId || baselineVersionId === versionId) return { kind: "not_found" as const };
  const rows = await listVersionsChangeEvidenceRows(env.DB, projectId, [versionId, baselineVersionId]);
  const evidence = rows.map((row) => ({
    versionId: row.id,
    manifestHash: row.manifest_hash,
    index: row.entry_index ? projectEntryIndexDocumentSchema.parse(JSON.parse(row.entry_index)) : null,
  }));
  const current = evidence.find((row) => row.versionId === versionId);
  const previous = evidence.find((row) => row.versionId === baselineVersionId);
  if (!current?.manifestHash || !previous?.manifestHash || !current.index || !previous.index)
    return { kind: "not_found" as const };
  return { kind: "ok" as const, data: { current, previous } };
}
