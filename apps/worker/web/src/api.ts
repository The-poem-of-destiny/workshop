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
  Banner,
  DiffKind,
  DiscoveryResponse,
  FindingDiff,
  FindingRef,
  HomeResponse,
  JsonValue,
  MeResponse,
  ProjectDetail,
  ProjectListResponse,
  ProjectSummary,
  ReferenceItem,
  ReferenceSet,
  ReferenceVersion,
  SiteSettings,
  SubmissionDiff,
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
  ProjectListResponse,
  ProjectSummary,
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

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string")
        message = body.message;
    } catch {
      /* non-json error */
    }
    throw new Error(message);
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
  rankings: (kind: "daily" | "7d" | "30d") =>
    requestJson<{
      kind: string;
      bucket: string | null;
      items: { rank: number; score: number; project: ProjectSummary }[];
    }>(`/api/v1/projects/rankings?kind=${kind}`),
  projects: (params: {
    search?: string;
    sort?: string;
    cursor?: string;
    projectType?: string;
    authorId?: string;
    tag?: string;
  }) => {
    const query = new URLSearchParams({ limit: "24" });
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
  uploadFile: (id: string, revisionId: string, kind: "worldbook" | "regex" | "cover", file: File) =>
    requestJson<{ kind: string; bytes: number; mime: string }>(
      `/api/v1/projects/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/files/${kind}`,
      { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file },
    ),
  submitProject: (
    id: string,
    revisionId: string,
    body: { gate?: string; checkerRevision?: string; warningCount?: number; acknowledged?: boolean },
  ) =>
    requestJson<{ submissionId: string; status: string }>(
      `/api/v1/projects/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/submit`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
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
  adminReview: (id: string, decision: "approve" | "reject", reason?: string) =>
    requestJson<{ id: string; status: string }>(`/api/v1/admin/submissions/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason }),
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
  auditEvents: (action?: string) =>
    requestJson<AdminAuditList>(
      `/api/v1/admin/audit-events?limit=20${action ? `&action=${encodeURIComponent(action)}` : ""}`,
    ),
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
