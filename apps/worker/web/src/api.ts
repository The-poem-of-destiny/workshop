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
  AuthorProject,
  AuthorProjectListResponse,
  AuthorSubmission,
  AuthorSubmissionListResponse,
  Banner,
  DiffKind,
  DiscoveryResponse,
  FindingDiff,
  FindingRef,
  HomeResponse,
  JsonValue,
  MeResponse,
  ProjectDetail,
  ProjectGalleryResponse,
  ProjectListResponse,
  ProjectPreview,
  ProjectPreviewKind,
  ProjectSummary,
  PublishedMetadataResponse,
  Recommendation,
  ReferenceItem,
  ReferenceSet,
  ReferenceVersion,
  SiteSettings,
  SubmissionDiff,
  SubmitResponse,
  UploadResponse,
} from "@workshop/contracts";

export type {
  AdminAuditEvent,
  AdminAuditList,
  AdminMember,
  AdminMemberList,
  AdminProject,
  AdminProjectList,
  AdminSubmissionDetail,
  AdminSubmissionListResponse,
  AuthorProject,
  AuthorProjectListResponse,
  AuthorSubmission,
  DiffKind,
  DiscoveryResponse,
  FindingDiff,
  FindingRef,
  HomeResponse,
  JsonValue,
  MeResponse,
  ProjectDetail,
  ProjectGalleryResponse,
  ProjectListResponse,
  ProjectPreview,
  ProjectPreviewKind,
  ProjectSummary,
  PublishedMetadataResponse,
  Recommendation,
  ReferenceItem,
  ReferenceSet,
  ReferenceVersion,
  SiteSettings,
  SubmissionDiff,
};

export type AcquisitionPayload = AcquisitionResponse;
export type SiteBanner = Banner;
export type AdminSubmissionListItem = AdminSubmissionListResponse["items"][number];

const TOKEN_KEY = "cw_session_token";
function token(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setSessionToken(value: string | null): void {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sandboxed iframe */
  }
}
function authHeaders(): Record<string, string> {
  const value = token();
  return value ? { authorization: `Bearer ${value}` } : {};
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: unknown;

  constructor(status: number, statusText: string, code: string | null, message: string, details: unknown) {
    super(`${status} ${code ? `${code}: ` : ""}${message || statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    let message = "";
    let code: string | null = null;
    let details: unknown;
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && !Array.isArray(body)) {
        if ("message" in body && typeof body.message === "string") message = body.message;
        if ("error" in body && typeof body.error === "object" && body.error !== null && !Array.isArray(body.error)) {
          if ("message" in body.error && typeof body.error.message === "string") message = body.error.message;
          if ("code" in body.error && typeof body.error.code === "string") code = body.error.code;
          if ("details" in body.error) details = body.error.details;
        }
      }
    } catch {
      /* non-json error */
    }
    throw new ApiError(response.status, response.statusText, code, message, details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  hasSession: () => Boolean(token()),
  me: () => requestJson<MeResponse>("/api/v1/me"),
  home: () => requestJson<HomeResponse>("/api/v1/home"),
  discovery: () => requestJson<DiscoveryResponse>("/api/v1/projects/discovery"),
  project: (id: string) => requestJson<ProjectDetail>(`/api/v1/projects/${encodeURIComponent(id)}`),
  projectPreview: (id: string, kind: ProjectPreviewKind) =>
    requestJson<ProjectPreview>(`/api/v1/projects/${encodeURIComponent(id)}/preview/${encodeURIComponent(kind)}`),
  projectGallery: (id: string) =>
    requestJson<ProjectGalleryResponse>(`/api/v1/projects/${encodeURIComponent(id)}/gallery`),
  galleryImage: async (url: string): Promise<Blob> => {
    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.blob();
  },
  uploadGalleryImage: (id: string, slot: number, rowVersion: number, file: File) =>
    requestJson<{ rowVersion: number; sha256: string; bytes: number; mime: string }>(
      `/api/v1/projects/${encodeURIComponent(id)}/gallery/${slot}`,
      {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream", "if-match": String(rowVersion) },
        body: file,
      },
    ),
  deleteGalleryImage: (id: string, slot: number, rowVersion: number) =>
    requestJson<{ rowVersion: number }>(`/api/v1/projects/${encodeURIComponent(id)}/gallery/${slot}`, {
      method: "DELETE",
      headers: { "if-match": String(rowVersion) },
    }),
  projects: (params: {
    search?: string;
    sort?: string;
    cursor?: string;
    limit?: number;
    projectType?: string;
    authorId?: string;
    tag?: string;
  }) => {
    const query = new URLSearchParams({ limit: String(params.limit ?? 25) });
    if (params.search) query.set("search", params.search);
    if (params.sort) query.set("sort", params.sort);
    if (params.cursor) query.set("cursor", params.cursor);
    if (params.projectType) query.set("projectType", params.projectType);
    if (params.authorId) query.set("authorId", params.authorId);
    if (params.tag) query.set("tag", params.tag);
    return requestJson<ProjectListResponse>(`/api/v1/projects?${query}`);
  },
  myProjects: () => requestJson<AuthorProjectListResponse>("/api/v1/me/projects"),
  subscriptions: () => requestJson<{ items: ProjectSummary[] }>("/api/v1/me/subscriptions"),
  authorSubmissions: (id: string) =>
    requestJson<AuthorSubmissionListResponse>(`/api/v1/me/projects/${encodeURIComponent(id)}/submissions`),
  setRating: (id: string, rating: number, comment?: string) =>
    requestJson<null>(`/api/v1/me/ratings/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating, comment }),
    }),
  deleteRating: (id: string) => requestJson<null>(`/api/v1/me/ratings/${encodeURIComponent(id)}`, { method: "DELETE" }),
  recommendations: () => requestJson<{ items: Recommendation[] }>("/api/v1/recommendations"),
  meState: (ids: string[]) =>
    requestJson<{ items: { projectId: string; liked: boolean; subscribed: boolean; rating: number | null }[] }>(
      `/api/v1/me/state?ids=${encodeURIComponent(ids.join(","))}`,
    ),
  setLike: (id: string, liked: boolean) =>
    requestJson<null>(`/api/v1/me/likes/${encodeURIComponent(id)}`, { method: liked ? "PUT" : "DELETE" }),
  setSubscription: (id: string, subscribed: boolean) =>
    requestJson<null>(`/api/v1/me/subscriptions/${encodeURIComponent(id)}`, {
      method: subscribed ? "PUT" : "DELETE",
    }),
  createProject: (body: Record<string, unknown>) =>
    requestJson<AuthorProject>("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  patchProject: (id: string, rowVersion: number, body: Record<string, unknown>) =>
    requestJson<{ rowVersion: number; revisionId: string }>("/api/v1/projects/" + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": String(rowVersion) },
      body: JSON.stringify(body),
    }),
  createRevision: (id: string, rowVersion: number, body: Record<string, unknown>) =>
    requestJson<{ rowVersion: number; revisionId: string }>(
      "/api/v1/projects/" + encodeURIComponent(id) + "/revisions",
      {
        method: "POST",
        headers: { "content-type": "application/json", "if-match": String(rowVersion) },
        body: JSON.stringify(body),
      },
    ),
  deleteProject: (id: string, rowVersion: number) =>
    requestJson<void>("/api/v1/projects/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: { "if-match": String(rowVersion) },
    }),
  authorCover: async (id: string, revisionId: string): Promise<Blob> => {
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/files/cover`,
      { headers: authHeaders() },
    );
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.blob();
  },
  publishedMetadata: (id: string) =>
    requestJson<PublishedMetadataResponse>(`/api/v1/projects/${encodeURIComponent(id)}/published-metadata`),
  patchPublishedMetadata: (id: string, rowVersion: number, body: Record<string, unknown>) =>
    requestJson<{ rowVersion: number }>(`/api/v1/projects/${encodeURIComponent(id)}/published-metadata`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": String(rowVersion) },
      body: JSON.stringify(body),
    }),
  publishedCover: async (id: string): Promise<Blob> => {
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(id)}/published-cover`, {
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.blob();
  },
  uploadPublishedCover: (id: string, rowVersion: number, file: File) =>
    requestJson<{ rowVersion: number; sha256: string; bytes: number; mime: string }>(
      `/api/v1/projects/${encodeURIComponent(id)}/published-cover`,
      {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream", "if-match": String(rowVersion) },
        body: file,
      },
    ),
  uploadFile: (id: string, revisionId: string, rowVersion: number, kind: "worldbook" | "regex" | "cover", file: File) =>
    requestJson<UploadResponse>(
      `/api/v1/projects/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/files/${kind}`,
      {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream", "if-match": String(rowVersion) },
        body: file,
      },
    ),
  submitProject: (
    id: string,
    revisionId: string,
    rowVersion: number,
    body: { gate?: string; checkerRevision?: string; warningCount?: number; acknowledged?: boolean },
  ) =>
    requestJson<SubmitResponse>(
      `/api/v1/projects/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/submit`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "if-match": String(rowVersion) },
        body: JSON.stringify(body),
      },
    ),
  adminSubmissions: (status: string, cursor?: string) =>
    requestJson<AdminSubmissionListResponse>(
      `/api/v1/admin/submissions?status=${encodeURIComponent(status)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  adminSubmission: (id: string) =>
    requestJson<AdminSubmissionDetail>(`/api/v1/admin/submissions/${encodeURIComponent(id)}`),
  adminDiff: (id: string) => requestJson<SubmissionDiff>(`/api/v1/admin/submissions/${encodeURIComponent(id)}/diff`),
  adminFile: (id: string, kind: "worldbook" | "regex" | "cover") =>
    fetch(`/api/v1/admin/submissions/${encodeURIComponent(id)}/files/${kind}`, { headers: authHeaders() }).then(
      async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.blob();
      },
    ),
  adminRecheck: (id: string) =>
    requestJson<{ ok: boolean; status: string }>(`/api/v1/admin/submissions/${encodeURIComponent(id)}/recheck`, {
      method: "POST",
    }),
  adminReview: (
    id: string,
    body: {
      decision: "approve" | "reject";
      reason?: string;
      revisionId?: string;
      manifestHash?: string;
      reportHash?: string;
    },
  ) =>
    requestJson<{ id: string; status: string }>(`/api/v1/admin/submissions/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  createFlow: async (mode: "browser" | "device" = "browser") =>
    requestJson<{ id: string; url: string; expiresAt: string; deviceCode?: string }>("/api/v1/auth/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    }),
  authFlowStatus: (id: string, deviceCode?: string) =>
    requestJson<{
      status: "pending" | "authorized" | "redeemed" | "expired";
      expiresAt: string;
      error?: string | null;
    }>(
      `/api/v1/auth/flows/${encodeURIComponent(id)}${deviceCode ? `?deviceCode=${encodeURIComponent(deviceCode)}` : ""}`,
    ),
  redeemFlow: (id: string, deviceCode: string) =>
    requestJson<{ token: string; expiresAt: string }>(`/api/v1/auth/flows/${encodeURIComponent(id)}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    }),
  acquisitions: (projectId: string) => {
    const params = new URLSearchParams(location.search);
    const version = params.get("clientVersion");
    const channel = params.get("clientChannel");
    const headers: Record<string, string> = {};
    if (version) headers["x-client-version"] = version;
    if (channel === "stable" || channel === "staging") headers["x-client-channel"] = channel;
    return requestJson<AcquisitionPayload>(`/api/v1/projects/${encodeURIComponent(projectId)}/acquisitions`, {
      method: "POST",
      headers,
    });
  },
  downloadTicketText: async (url: string) => {
    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  },
  downloadTickets: (projectId: string) =>
    requestJson<{ revisionId: string; files: { kind: string; url: string; expiresAt: string }[] }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/downloads`,
      { method: "POST" },
    ),
  downloadTicket: async (url: string) => {
    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.blob();
  },
  adminProjects: (search?: string) =>
    requestJson<AdminProjectList>(
      `/api/v1/admin/projects?limit=50${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ),
  adminMembers: (cursor?: string) =>
    requestJson<AdminMemberList>(`/api/v1/admin/members${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  adminSetRole: (id: string, role: "member" | "reviewer" | "owner") =>
    requestJson<{ ok: boolean }>(`/api/v1/admin/members/${encodeURIComponent(id)}/role`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    }),
  site: () => requestJson<SiteSettings>("/api/v1/site"),
  uploadBanner: (file: File) =>
    requestJson<{ banner: SiteBanner }>("/api/v1/site/banner", {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
    }),
  updateSite: (body: { banner?: SiteBanner; siteContent?: JsonValue }) =>
    requestJson<SiteSettings>("/api/v1/site", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  auditEvents: (params: { action?: string; cursor?: string } = {}) => {
    const query = new URLSearchParams({ limit: "20" });
    if (params.action) query.set("action", params.action);
    if (params.cursor) query.set("cursor", params.cursor);
    return requestJson<AdminAuditList>(`/api/v1/admin/audit-events?${query}`);
  },
  updateRecommendation: (projectId: string, body: { comment?: string; reaction?: string }) =>
    requestJson<{ id: string; comment: string; reaction: string }>(
      `/api/v1/admin/recommendations/${encodeURIComponent(projectId)}`,
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    ),
  deleteRecommendation: (projectId: string) =>
    requestJson<void>(`/api/v1/admin/recommendations/${encodeURIComponent(projectId)}`, { method: "DELETE" }),
  referenceSets: () => requestJson<{ items: ReferenceSet[] }>("/api/v1/reference-sets"),
  createReferenceSet: (body: { name: string; versionLabel: string; description?: string | null }) =>
    requestJson<{ id: string; versionId: string }>("/api/v1/admin/reference-sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  createReferenceVersion: (id: string, body: { versionLabel: string; items?: unknown[] }) =>
    requestJson<{ id: string; ordinal: number }>(`/api/v1/admin/reference-sets/${encodeURIComponent(id)}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  updateReferenceSet: (
    id: string,
    body: { name?: string; description?: string | null; versionLabel?: string; items?: unknown[] },
  ) =>
    requestJson<{ ok: boolean }>(`/api/v1/admin/reference-sets/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  logout: async () => {
    await fetch("/api/v1/sessions/current", { method: "DELETE", headers: authHeaders() });
    setSessionToken(null);
  },
};
