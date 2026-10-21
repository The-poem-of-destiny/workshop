export interface ProjectSummary {
  id: string;
  title: string;
  description: string | null;
  author: { id: string; name: string; avatarUrl: string | null };
  projectType: string | null;
  extensionType: string | null;
  tags: string[];
  entries: { worldbook: number; regex: number };
  schemaVersion: string | null;
  versionLabel?: string | null;
  counts: { downloads: number; likes: number; subscriptions: number };
  coverUrl: string | null;
  visibility: "public" | "private";
  publishedAt: string | null;
  updatedAt: string;
}

export interface HomeResponse {
  banner: { imageUrl: string | null; positionX: number; positionY: number; zoom: number } | null;
  latest: ProjectSummary[];
  recommendations: ProjectSummary[];
}

export interface ProjectListResponse { items: ProjectSummary[]; nextCursor: string | null; }
export interface MeResponse {
  user: { id: string; username: string; globalName: string | null; avatarUrl: string | null; role: string };
}
export interface InstallPayload {
  project: { id: string; title: string; version: string; projectType: string | null; extensionType: string | null };
  files: { worldbook?: string; regex?: string };
}
export interface AuthorSubmission {
  id: string;
  revisionId: string;
  status: "pending" | "checking" | "approved" | "rejected" | "superseded";
  gate: string | null;
  checkerRevision: string | null;
  submittedAt: string;
  resolvedAt: string | null;
  decision: "approve" | "reject" | null;
  reason: string | null;
  reviewedAt: string | null;
  checkStatus: "queued" | "running" | "done" | "needs_human" | "failed";
  checkError: string | null;
  checkedAt: string | null;
}
export interface AuthorProject { project: ProjectSummary; rowVersion: number; workingRevisionId: string | null; latestSubmission: AuthorSubmission | null; }
export interface AuthorProjectListResponse { items: AuthorProject[]; }
export interface AdminSubmissionListItem {
  id: string; projectId: string; projectTitle: string; author: { id: string; name: string };
  status: string; gate: string | null; checkerRevision: string | null; checkStatus: string; submittedAt: string;
}
export interface AdminSubmissionListResponse { items: AdminSubmissionListItem[]; nextCursor: string | null; }
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface AdminSubmissionDetail {
  submission: {
    id: string; projectId: string; revisionId: string; status: string; gate: string | null;
    checkerRevision: string | null; submittedBy: string; submittedAt: string; resolvedAt: string | null;
    clientGate: string | null; clientCheckerRevision: string | null; clientWarningCount: number | null;
    clientAcknowledgedAt: string | null; checkStatus: string; checkAttempts: number; checkError: string | null;
    checkReport: JsonValue; checkReportHash: string | null; checkedAt: string | null;
    reviewCheckerRevision: string | null; autoPublishedAt: string | null;
  };
  project: { id: string; title: string; description: string | null; visibility: string; author: { id: string; name: string } };
  revision: { id: string; revisionNo: number; title: string; description: string | null; authorNote: string | null; projectType: string | null; extensionType: string | null; searchTags: JsonValue; metadata: JsonValue; manifestHash: string | null; createdAt: string };
  assets: { id: string; kind: string; sha256: string; bytes: number; mime: string; r2Key: string }[];
  checkRuns: { id: string; reviewCheckerRevision: string; routeGate: string; report: JsonValue; reportHash: string; durationMs: number; createdAt: string }[];
  review: { id: string; submissionId: string; reviewerId: string; decision: string; reason: string | null; manifestHash: string; checkerVersion: string; report: JsonValue; createdAt: string } | null;
}
export interface DiffKind { added: { entryKey: string; name: string }[]; modified: { entryKey: string; name: string; changedFields?: string[] }[]; deleted: { entryKey: string; name: string }[]; unchanged: number; }
export interface SubmissionDiff {
  revisionId: string; previousRevisionId: string | null; worldbook: DiffKind; regex: DiffKind;
  cover: { changed: boolean; beforeSha256: string | null; afterSha256: string | null };
}

export interface AdminMember { id: string; username: string; globalName: string | null; avatarUrl: string | null; role: string; }
export interface AdminMemberList { items: AdminMember[]; nextCursor: string | null; }
export interface AdminAuditEvent { id: string; action: string; targetType: string; targetId: string | null; actorId: string | null; actorName: string | null; detail: JsonValue; createdAt: string; }
export interface AdminAuditList { items: AdminAuditEvent[]; nextCursor: string | null; }
export interface SiteBanner { imageUrl: string | null; positionX: number; positionY: number; zoom: number; mobilePositionX: number; mobilePositionY: number; mobileZoom: number; }
export interface SiteSettings { banner: SiteBanner | null; siteContent: JsonValue; }
export interface ReferenceItem { id: string; kind: "worldbook" | "regex"; displayName: string; exactHash: string; normalizedContentHash: string; nameHash: string; structureHash: string; }
export interface ReferenceVersion { id: string; label: string; ordinal: number; graceUntil: string; worldbookCount: number; regexCount: number; items?: ReferenceItem[]; }
export interface ReferenceSet { id: string; name: string; description: string | null; versions: ReferenceVersion[]; }

const TOKEN_KEY = "cw_session_token";
function token(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setSessionToken(value: string | null): void {
  try { if (value) sessionStorage.setItem(TOKEN_KEY, value); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* sandboxed iframe */ }
}
function authHeaders(): Record<string, string> { const value = token(); return value ? { authorization: `Bearer ${value}` } : {}; }

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string") message = body.message;
    } catch { /* non-json error */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  hasSession: () => Boolean(token()),
  me: () => requestJson<MeResponse>("/api/v1/me"),
  home: () => requestJson<HomeResponse>("/api/v1/home"),
  projects: (params: { search?: string; sort?: string }) => {
    const query = new URLSearchParams({ limit: "24" });
    if (params.search) query.set("search", params.search);
    if (params.sort) query.set("sort", params.sort);
    return requestJson<ProjectListResponse>(`/api/v1/projects?${query}`);
  },
  myProjects: () => requestJson<AuthorProjectListResponse>("/api/v1/me/projects"),
  createProject: (body: Record<string, unknown>) => requestJson<AuthorProject>("/api/v1/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  patchProject: (id: string, rowVersion: number, body: Record<string, unknown>) => requestJson<{ rowVersion: number; revisionId: string }>("/api/v1/projects/" + encodeURIComponent(id), { method: "PATCH", headers: { "content-type": "application/json", "if-match": String(rowVersion) }, body: JSON.stringify(body) }),
  deleteProject: (id: string, rowVersion: number) => requestJson<void>("/api/v1/projects/" + encodeURIComponent(id), { method: "DELETE", headers: { "if-match": String(rowVersion) } }),
  uploadFile: (id: string, revisionId: string, kind: "worldbook" | "regex" | "cover", file: File) => requestJson<{ kind: string; bytes: number; mime: string }>(`/api/v1/projects/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/files/${kind}`, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file }),
  submitProject: (id: string, revisionId: string, body: { gate?: string; checkerRevision?: string; warningCount?: number; acknowledged?: boolean }) => requestJson<{ submissionId: string; status: string }>(`/api/v1/projects/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  adminSubmissions: (status: "pending" | "checking") => requestJson<AdminSubmissionListResponse>(`/api/v1/admin/submissions?status=${status}`),
  adminSubmission: (id: string) => requestJson<AdminSubmissionDetail>(`/api/v1/admin/submissions/${encodeURIComponent(id)}`),
  adminDiff: (id: string) => requestJson<SubmissionDiff>(`/api/v1/admin/submissions/${encodeURIComponent(id)}/diff`),
  adminFile: (id: string, kind: "worldbook" | "regex" | "cover") => fetch(`/api/v1/admin/submissions/${encodeURIComponent(id)}/files/${kind}`, { headers: authHeaders() }).then(async response => { if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); return response.blob(); }),
  adminRecheck: (id: string) => requestJson<{ ok: boolean; status: string }>(`/api/v1/admin/submissions/${encodeURIComponent(id)}/recheck`, { method: "POST" }),
  adminReview: (id: string, decision: "approve" | "reject", reason?: string) => requestJson<{ id: string; status: string }>(`/api/v1/admin/submissions/${encodeURIComponent(id)}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, reason }) }),
  createFlow: async () => requestJson<{ id: string; url: string; expiresAt: string }>("/api/v1/auth/flows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "browser" }) }),
  install: (projectId: string) => {
    const version = new URLSearchParams(location.search).get("clientVersion");
    return requestJson<InstallPayload>(`/api/v1/projects/${encodeURIComponent(projectId)}/install`, version ? { headers: { "x-client-version": version, "x-client-channel": location.pathname.includes("staging") ? "staging" : "stable" } } : {});
  },
  adminMembers: (cursor?: string) => requestJson<AdminMemberList>(`/api/v1/admin/members${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  adminSetRole: (id: string, role: "member" | "reviewer" | "owner") => requestJson<{ ok: boolean }>(`/api/v1/admin/members/${encodeURIComponent(id)}/role`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) }),
  site: () => requestJson<SiteSettings>("/api/v1/site"),
  updateSite: (body: { banner?: SiteBanner; siteContent?: JsonValue }) => requestJson<SiteSettings>("/api/v1/site", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  auditEvents: (action?: string) => requestJson<AdminAuditList>(`/api/v1/admin/audit-events?limit=20${action ? `&action=${encodeURIComponent(action)}` : ""}`),
  updateRecommendation: (projectId: string, body: { comment?: string; reaction?: string }) => requestJson<{ id: string; comment: string; reaction: string }>(`/api/v1/admin/recommendations/${encodeURIComponent(projectId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  deleteRecommendation: (projectId: string) => requestJson<void>(`/api/v1/admin/recommendations/${encodeURIComponent(projectId)}`, { method: "DELETE" }),
  referenceSets: () => requestJson<{ items: ReferenceSet[] }>("/api/v1/reference-sets"),
  updateReferenceSet: (id: string, body: { name?: string; description?: string | null; versionLabel?: string; items?: unknown[] }) => requestJson<{ ok: boolean }>(`/api/v1/admin/reference-sets/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  logout: async () => { await fetch("/api/v1/sessions/current", { method: "DELETE", headers: authHeaders() }); setSessionToken(null); },
};
