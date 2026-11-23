import type {
  AcquisitionResponse,
  AdminAuditEvent,
  AdminAuditList,
  AdminMember,
  AdminMemberList,
  AdminProject,
  AdminProjectList,
  AdminSubmissionDetail,
  AdminSubmissionListResponse,
  AuditAction,
  AuthFlowResponse,
  AuthorCollection,
  AuthorCollectionListResponse,
  AuthorProfileResponse,
  AuthorProject,
  AuthorProjectListResponse,
  AuthorSubmission,
  AuthorSubmissionListResponse,
  Banner,
  CollectionSummary,
  DiscoveryResponse,
  ExperienceNotesResponse,
  HomeResponse,
  JsonValue,
  MeResponse,
  MeStateResponse,
  PolicyAcceptanceInput,
  PolicyAcceptanceResponse,
  ProjectBatchResponse,
  ProjectDetail,
  ProjectGalleryResponse,
  ProjectListResponse,
  ProjectPreview,
  ProjectPreviewKind,
  ProjectSummary,
  Recommendation,
  SiteSettings,
  SubmissionDiff,
  SubmitResponse,
  UploadResponse,
  UserPolicyState,
  Visibility,
} from "@workshop/contracts";
import { MAX_SELECTED_TAGS, normalizeProjectBatchIds, PROJECT_TYPES, type ProjectType } from "@workshop/domain";
import {
  ApiError,
  formatApiErrorMessage,
  formatUserError,
  getSessionGeneration,
  hasSessionToken,
  jsonRequest,
  requestBlob,
  requestJson,
  requestJsonWithHeaders,
  requestText,
  setSessionToken,
  subscribeSessionChange,
} from "./lib/api-client";
import { newId } from "./lib/newId";

export type {
  AdminAuditEvent,
  AdminAuditList,
  AdminMember,
  AdminMemberList,
  AdminProject,
  AdminProjectList,
  AdminSubmissionDetail,
  AdminSubmissionListResponse,
  AuditAction,
  AuthorCollection,
  AuthorCollectionListResponse,
  AuthorProfileResponse,
  AuthorProject,
  AuthorProjectListResponse,
  AuthorSubmission,
  CollectionSummary,
  DiscoveryResponse,
  HomeResponse,
  JsonValue,
  MeResponse,
  PolicyAcceptanceInput,
  PolicyAcceptanceResponse,
  ProjectBatchResponse,
  ProjectDetail,
  ProjectGalleryResponse,
  ProjectListResponse,
  ProjectPreview,
  ProjectPreviewKind,
  ProjectSummary,
  Recommendation,
  SiteSettings,
  SubmissionDiff,
  UserPolicyState,
  Visibility,
};
export {
  ApiError,
  formatApiErrorMessage,
  formatUserError,
  getSessionGeneration,
  setSessionToken,
  subscribeSessionChange,
};

export type AcquisitionPayload = AcquisitionResponse;
export type SiteBanner = Banner;
export type AdminSubmissionListItem = AdminSubmissionListResponse["items"][number];

const encode = encodeURIComponent;

export const api = {
  hasSession: hasSessionToken,
  me: () => requestJson<MeResponse>("/api/v1/me"),
  acceptPolicy: (body: PolicyAcceptanceInput) =>
    jsonRequest<PolicyAcceptanceResponse>("/api/v1/me/policy-acceptance", "POST", body),
  myCollections: () => requestJson<AuthorCollectionListResponse>("/api/v1/me/collections"),
  createCollection: (body: { title: string; description?: string; projectIds?: string[] }) =>
    jsonRequest<AuthorCollection>("/api/v1/collections", "POST", body),
  patchCollection: (id: string, body: { title?: string; description?: string; projectIds?: string[] }) =>
    jsonRequest<AuthorCollection>(`/api/v1/collections/${encode(id)}`, "PATCH", body),
  deleteCollection: (id: string) => requestJson<void>(`/api/v1/collections/${encode(id)}`, { method: "DELETE" }),
  setProjectCollections: (id: string, collectionIds: string[]) =>
    jsonRequest<{ collectionIds: string[] }>(`/api/v1/projects/${encode(id)}/collections`, "PUT", { collectionIds }),
  collection: (id: string) => requestJson<CollectionSummary>(`/api/v1/collections/${encode(id)}`, {}, true),
  authorProfile: (id: string) => requestJson<AuthorProfileResponse>(`/api/v1/authors/${encode(id)}`, {}, true),
  home: () => requestJson<HomeResponse>("/api/v1/home", {}, true),
  projectsByIds: async (ids: string[]): Promise<ProjectBatchResponse> => {
    const normalized = normalizeProjectBatchIds(ids);
    if (normalized.length === 0) return { items: [], missingIds: [] };
    const query = new URLSearchParams({ ids: normalized.join(",") });
    const raw = await requestJson<ProjectBatchResponse>(`/api/v1/projects/batch?${query}`, {}, true);
    if (
      !raw ||
      typeof raw !== "object" ||
      !Array.isArray(raw.items) ||
      !Array.isArray(raw.missingIds) ||
      raw.items.some((item) => !item || typeof item !== "object" || typeof item.id !== "string") ||
      raw.missingIds.some((id) => typeof id !== "string")
    ) {
      throw new Error("Invalid project batch response");
    }
    const returned = [...raw.items.map((item) => item.id), ...raw.missingIds];
    if (
      returned.length !== normalized.length ||
      new Set(returned).size !== normalized.length ||
      returned.some((id) => !normalized.includes(id))
    ) {
      throw new Error("Invalid project batch response");
    }
    return raw;
  },
  project: (id: string) => requestJson<ProjectDetail>(`/api/v1/projects/${encode(id)}`, {}, true),
  projectPreview: (id: string, kind: ProjectPreviewKind) =>
    requestJson<ProjectPreview>(`/api/v1/projects/${encode(id)}/preview/${encode(kind)}`),
  projectGallery: (id: string) => requestJson<ProjectGalleryResponse>(`/api/v1/projects/${encode(id)}/gallery`),
  galleryImage: requestBlob,
  uploadGalleryImage: (id: string, slot: number, rowVersion: number, file: File) =>
    requestJson<{ rowVersion: number; sha256: string; bytes: number; mime: string }>(
      `/api/v1/projects/${encode(id)}/gallery/${slot}`,
      {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream", "if-match": String(rowVersion) },
        body: file,
      },
    ),
  deleteGalleryImage: (id: string, slot: number, rowVersion: number) =>
    requestJson<{ rowVersion: number }>(`/api/v1/projects/${encode(id)}/gallery/${slot}`, {
      method: "DELETE",
      headers: { "if-match": String(rowVersion) },
    }),
  projects: (params: {
    search?: string;
    sort?: string;
    period?: "all" | "7d" | "30d" | "90d";
    cursor?: string;
    limit?: number;
    projectTypes?: readonly ProjectType[];
    includeContained?: boolean;
    authorId?: string;
    collectionId?: string;
    tags?: readonly string[];
  }) => {
    const tags = [...new Set((params.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort();
    if (tags.length > MAX_SELECTED_TAGS) {
      return Promise.reject(new Error(`最多可同时筛选 ${MAX_SELECTED_TAGS} 个标签。`));
    }
    const query = new URLSearchParams();
    if (params.limit !== undefined && params.limit !== 25) query.set("limit", String(params.limit));
    if (params.search?.trim()) query.set("search", params.search.trim());
    if (params.sort && params.sort !== "published") query.set("sort", params.sort);
    if (params.period && params.period !== "30d" && (params.sort === "likes" || params.sort === "downloads")) {
      query.set("period", params.period);
    }
    if (params.cursor) query.set("cursor", params.cursor);
    for (const type of PROJECT_TYPES) {
      if (params.projectTypes?.includes(type)) query.append("projectType", type);
    }
    if (params.includeContained) query.set("includeContained", "true");
    if (params.authorId?.trim()) query.set("authorId", params.authorId.trim());
    if (params.collectionId?.trim()) query.set("collectionId", params.collectionId.trim());
    for (const tag of tags) query.append("tag", tag);
    query.sort();
    const search = query.toString();
    return requestJson<ProjectListResponse>(`/api/v1/projects${search ? `?${search}` : ""}`, {}, true);
  },
  myProjects: () => requestJson<AuthorProjectListResponse>("/api/v1/me/projects"),
  subscriptions: () => requestJson<{ items: ProjectSummary[] }>("/api/v1/me/subscriptions"),
  authorSubmissions: (id: string) =>
    requestJson<AuthorSubmissionListResponse>(`/api/v1/me/projects/${encode(id)}/submissions`),
  experienceNotes: (id: string) => requestJson<ExperienceNotesResponse>(`/api/v1/me/experience-notes/${encode(id)}`),
  setExperienceNote: (id: string, versionId: string, rating: number, comment?: string) =>
    jsonRequest<null>(`/api/v1/me/experience-notes/${encode(id)}/versions/${encode(versionId)}`, "PUT", {
      rating,
      comment,
    }),
  deleteExperienceNote: (id: string, versionId: string) =>
    requestJson<null>(`/api/v1/me/experience-notes/${encode(id)}/versions/${encode(versionId)}`, { method: "DELETE" }),
  deleteUnversionedNote: (id: string) =>
    requestJson<null>(`/api/v1/me/experience-notes/${encode(id)}/unversioned`, { method: "DELETE" }),
  recommendations: () => requestJson<{ items: Recommendation[] }>("/api/v1/recommendations", {}, true),
  meState: (ids: string[]) => requestJson<MeStateResponse>(`/api/v1/me/state?ids=${encode(ids.join(","))}`),
  setLike: (id: string, liked: boolean) =>
    requestJson<null>(`/api/v1/me/likes/${encode(id)}`, { method: liked ? "PUT" : "DELETE" }),
  setSubscription: (id: string, subscribed: boolean) =>
    requestJson<null>(`/api/v1/me/subscriptions/${encode(id)}`, { method: subscribed ? "PUT" : "DELETE" }),
  createProject: (body: Record<string, unknown>) => jsonRequest<AuthorProject>("/api/v1/projects", "POST", body),
  patchProject: (id: string, rowVersion: number, body: Record<string, unknown>) =>
    jsonRequest<{ rowVersion: number; versionId: string }>(`/api/v1/projects/${encode(id)}`, "PATCH", body, {
      "if-match": String(rowVersion),
    }),
  createVersion: (id: string, rowVersion: number, body: Record<string, unknown>) =>
    jsonRequest<{ rowVersion: number; versionId: string }>(`/api/v1/projects/${encode(id)}/versions`, "POST", body, {
      "if-match": String(rowVersion),
    }),
  deleteProject: (id: string, rowVersion: number) =>
    requestJson<void>(`/api/v1/projects/${encode(id)}`, {
      method: "DELETE",
      headers: { "if-match": String(rowVersion) },
    }),
  setVisibility: (id: string, rowVersion: number, visibility: Visibility) =>
    jsonRequest<{ rowVersion: number }>(
      `/api/v1/projects/${encode(id)}/visibility`,
      "PATCH",
      { visibility },
      { "if-match": String(rowVersion) },
    ),
  authorAsset: (id: string, versionId: string, kind: "worldbook" | "regex") =>
    requestJson<unknown>(`/api/v1/projects/${encode(id)}/versions/${encode(versionId)}/files/${kind}`),
  deleteProjectEntry: (
    id: string,
    versionId: string,
    rowVersion: number,
    kind: "worldbook" | "regex",
    entryKey: string,
  ) =>
    requestJson<{ rowVersion: number; versionId: string; entryCount: number }>(
      `/api/v1/projects/${encode(id)}/versions/${encode(versionId)}/entries/${kind}/${encode(entryKey)}`,
      { method: "DELETE", headers: { "if-match": String(rowVersion) } },
    ),
  authorCover: (id: string, versionId: string) =>
    requestBlob(`/api/v1/projects/${encode(id)}/versions/${encode(versionId)}/files/cover`),
  uploadFile: (id: string, versionId: string, rowVersion: number, kind: "worldbook" | "regex" | "cover", file: File) =>
    requestJson<UploadResponse>(`/api/v1/projects/${encode(id)}/versions/${encode(versionId)}/files/${kind}`, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream", "if-match": String(rowVersion) },
      body: file,
    }),
  withdrawSubmission: (id: string, submissionId: string, rowVersion: number) =>
    requestJson<{ rowVersion: number; submissionId: string; status: "superseded"; withdrawnAt: string }>(
      `/api/v1/projects/${encode(id)}/submissions/${encode(submissionId)}/withdraw`,
      { method: "POST", headers: { "if-match": String(rowVersion) } },
    ),
  reportProjectChange: async (projectId: string, versionId: string) => {
    type Evidence = {
      versionId: string;
      manifestHash: string;
      index: { entries: Array<{ kind: string; entryKey: string; contentHash: string }> };
    };
    const { current, previous } = await requestJson<{ current: Evidence; previous: Evidence }>(
      `/api/v1/projects/${encode(projectId)}/versions/${encode(versionId)}/change-evidence`,
    );
    const before = new Map(previous.index.entries.map((e) => [`${e.kind}:${e.entryKey}`, e.contentHash]));
    const after = new Map(current.index.entries.map((e) => [`${e.kind}:${e.entryKey}`, e.contentHash]));
    const keys = new Set([...before.keys(), ...after.keys()]);
    const changedEntries = [...keys].filter((key) => before.get(key) !== after.get(key)).length;
    if (!changedEntries) return;
    await jsonRequest("/api/v1/recommendations/changes", "POST", {
      projectId,
      projectVersionId: versionId,
      previousVersionId: previous.versionId,
      previousManifestHash: previous.manifestHash,
      currentManifestHash: current.manifestHash,
      changedEntries,
      totalEntries: keys.size,
    });
  },
  submitProject: (
    id: string,
    versionId: string,
    rowVersion: number,
    body: { gate?: "pass" | "warn" | "block"; checkerVersion?: string },
  ) =>
    jsonRequest<SubmitResponse>(`/api/v1/projects/${encode(id)}/versions/${encode(versionId)}/submit`, "POST", body, {
      "if-match": String(rowVersion),
    }),
  adminSubmissions: (status: string, cursor?: string) =>
    requestJson<AdminSubmissionListResponse>(
      `/api/v1/admin/submissions?status=${encode(status)}${cursor ? `&cursor=${encode(cursor)}` : ""}`,
    ),
  adminSubmission: (id: string) => requestJson<AdminSubmissionDetail>(`/api/v1/admin/submissions/${encode(id)}`),
  adminDiff: (id: string) => requestJson<SubmissionDiff>(`/api/v1/admin/submissions/${encode(id)}/diff`),
  adminFile: (id: string, kind: "worldbook" | "regex" | "cover") =>
    requestBlob(`/api/v1/admin/submissions/${encode(id)}/files/${kind}`),
  adminRecheck: (id: string) =>
    requestJson<{ ok: boolean; status: string }>(`/api/v1/admin/submissions/${encode(id)}/recheck`, { method: "POST" }),
  adminReview: (
    id: string,
    body: {
      decision: "approve" | "reject";
      reason?: string;
      versionId?: string;
      manifestHash?: string;
      reportHash?: string;
    },
  ) => jsonRequest<{ id: string; status: string }>(`/api/v1/admin/submissions/${encode(id)}/review`, "POST", body),
  createAuthFlow: async (
    mode: "browser" | "device" = "browser",
  ): Promise<{ flow: AuthFlowResponse; binding: string | null }> => {
    const { data, headers } = await requestJsonWithHeaders<AuthFlowResponse>("/api/v1/auth/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    return { flow: data, binding: headers.get("x-oauth-binding") };
  },
  authFlowStatus: (id: string, deviceCode?: string) =>
    requestJson<{
      status: "pending" | "authorized" | "redeemed" | "expired";
      expiresAt: string;
      error?: string | null;
    }>(`/api/v1/auth/flows/${encode(id)}${deviceCode ? `?deviceCode=${encode(deviceCode)}` : ""}`),
  redeemFlow: (id: string, deviceCode: string) =>
    jsonRequest<{ token: string; expiresAt: string }>(`/api/v1/auth/flows/${encode(id)}/redeem`, "POST", {
      deviceCode,
    }),
  acquisitions: (projectId: string) => {
    const params = new URLSearchParams(location.search);
    const version = params.get("clientVersion");
    const channel = params.get("clientChannel");
    const headers: Record<string, string> = { "Idempotency-Key": newId() };
    if (version) headers["x-client-version"] = version;
    if (channel === "stable" || channel === "staging") headers["x-client-channel"] = channel;
    return requestJson<AcquisitionPayload>(`/api/v1/projects/${encode(projectId)}/acquisitions`, {
      method: "POST",
      headers,
    });
  },
  downloadText: requestText,
  adminProjects: (search?: string) =>
    requestJson<AdminProjectList>(`/api/v1/admin/projects?limit=50${search ? `&search=${encode(search)}` : ""}`),
  adminMembers: (cursor?: string) =>
    requestJson<AdminMemberList>(`/api/v1/admin/members${cursor ? `?cursor=${encode(cursor)}` : ""}`),
  adminSetRole: (id: string, role: "member" | "reviewer" | "owner") =>
    jsonRequest<{ ok: boolean }>(`/api/v1/admin/members/${encode(id)}/role`, "PUT", { role }),
  site: () => requestJson<SiteSettings>("/api/v1/site", {}, true),
  uploadBanner: (file: File) =>
    requestJson<{ banner: SiteBanner }>("/api/v1/site/banner", {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
    }),
  updateSite: (body: { banner?: SiteBanner; siteContent?: JsonValue }) =>
    jsonRequest<SiteSettings>("/api/v1/site", "PUT", body),
  auditEvents: (params: { action?: AuditAction; cursor?: string } = {}) => {
    const query = new URLSearchParams({ limit: "20" });
    if (params.action) query.set("action", params.action);
    if (params.cursor) query.set("cursor", params.cursor);
    return requestJson<AdminAuditList>(`/api/v1/admin/audit-events?${query}`);
  },
  playerRecommendation: (projectId: string, body: { projectVersionId: string; comment?: string }, remove: boolean) =>
    jsonRequest<{ kind: "ok" }>(`/api/v1/recommendations/${encode(projectId)}`, remove ? "DELETE" : "PUT", body),
  updateRecommendation: (projectId: string, body: { comment?: string; projectVersionId: string }) =>
    jsonRequest<{ id: string; comment: string; projectVersionId: string }>(
      `/api/v1/admin/recommendations/${encode(projectId)}`,
      "PUT",
      body,
    ),
  deleteRecommendation: (projectId: string, id?: string) =>
    requestJson<void>(`/api/v1/admin/recommendations/${encode(projectId)}${id ? `?id=${encode(id)}` : ""}`, {
      method: "DELETE",
    }),
  logout: async () => {
    const generation = getSessionGeneration();
    await requestJson<void>("/api/v1/sessions/current", { method: "DELETE" });
    if (generation === getSessionGeneration()) setSessionToken(null);
  },
};
