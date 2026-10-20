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
  counts: { downloads: number; likes: number; subscriptions: number };
  coverUrl: string | null;
  visibility: "public" | "private";
  publishedAt: string | null;
  updatedAt: string;
}

export interface HomeResponse {
  banner: {
    imageUrl: string | null;
    positionX: number;
    positionY: number;
    zoom: number;
  } | null;
  latest: ProjectSummary[];
  recommendations: ProjectSummary[];
}

export interface ProjectListResponse {
  items: ProjectSummary[];
  nextCursor: string | null;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export const api = {
  home: () => getJson<HomeResponse>("/api/v1/home"),
  projects: (params: { search?: string; sort?: string }) => {
    const query = new URLSearchParams({ limit: "24" });
    if (params.search) query.set("search", params.search);
    if (params.sort) query.set("sort", params.sort);
    return getJson<ProjectListResponse>(`/api/v1/projects?${query}`);
  },
};
