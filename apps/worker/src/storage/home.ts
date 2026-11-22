import {
  type Banner,
  bannerSchema,
  type HomeResponse,
  type Recommendation,
  siteSettingsSchema,
} from "@workshop/contracts";
import { DEFAULT_COMMUNITY_INVITE_URL, parseDiscordInviteUrl } from "@workshop/domain";
import { isStorageQuotaError, quotaErrorDetail, quotaExceededMessage } from "../quota-error.js";
import { getPublishedProjectsByIds, listPublishedProjects } from "./projects.js";
import { readRecommendationBatch } from "./recommendation-batches.js";

interface RecommendationRow {
  id: string;
  curator_id: string;
  project_id: string;
  comment: string;
  project_version_id: string;
  curator_name: string;
  curator_avatar: string | null;
}

const DEFAULT_BANNER: Banner = {
  imageUrl: null,
  positionX: 50,
  positionY: 50,
  zoom: 1,
  mobilePositionX: 50,
  mobilePositionY: 50,
  mobileZoom: 1,
};

export const publicBannerPrefix = "covers/banner/";

interface BannerOrigins {
  PUBLIC_ORIGIN?: string;
  PUBLIC_ASSETS_BASE_URL?: string;
}

export interface BannerState {
  value: string;
  banner_revision: string | null;
  object_key: string | null;
  phase: "reserving" | "copying" | "ready" | "withdrawing" | null;
  reservation_etag: string | null;
}

export function bannerSourceKey(imageUrl: string | null, publicOrigin?: string): string | null {
  if (!imageUrl || /[?#]/.test(imageUrl)) return null;
  let path = imageUrl;
  if (!imageUrl.startsWith("/")) {
    const absolutePath = /^https?:\/\/[^/\\]+(\/[^\\]*)$/i.exec(imageUrl)?.[1];
    if (!publicOrigin || !absolutePath) return null;
    try {
      const url = new URL(imageUrl);
      if (url.origin !== new URL(publicOrigin).origin || url.username || url.password || url.pathname !== absolutePath)
        return null;
      path = url.pathname;
    } catch {
      return null;
    }
  }
  const name = /^\/api\/v1\/(?:public-assets|assets)\/banners\/([A-Za-z0-9_.-]+)$/.exec(path)?.[1];
  return name && name !== "." && name !== ".." ? `banners/${name}` : null;
}

export function bannerSourceUrl(state: BannerState | null): string | null {
  if (!state) return null;
  try {
    const value = JSON.parse(state.value) as { imageUrl?: unknown } | null;
    return typeof value?.imageUrl === "string" ? value.imageUrl : null;
  } catch {
    return null;
  }
}

export function publicBannerUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${key}`;
}

export function readBannerState(db: D1Database): Promise<BannerState | null> {
  return db
    .prepare(`SELECT s.value, s.banner_revision, r.object_key, r.phase, r.reservation_etag FROM site_settings s
    LEFT JOIN public_banner_replicas r ON r.id = 1 AND r.source_url =
      CASE WHEN json_valid(s.value) THEN json_extract(s.value, '$.imageUrl') END
    WHERE s.key = 'discover_banner'`)
    .first<BannerState>();
}

export function projectBanner(state: BannerState | null, origins?: BannerOrigins): Banner {
  if (!state) return DEFAULT_BANNER;
  try {
    const banner = bannerSchema.parse(JSON.parse(state.value));
    const key = bannerSourceKey(banner.imageUrl, origins?.PUBLIC_ORIGIN);
    if (key) {
      banner.imageUrl =
        state.phase === "ready" && state.object_key && origins?.PUBLIC_ASSETS_BASE_URL
          ? publicBannerUrl(origins.PUBLIC_ASSETS_BASE_URL, state.object_key)
          : `/api/v1/public-assets/${key}`;
    }
    return banner;
  } catch {
    return DEFAULT_BANNER;
  }
}

export async function getBanner(db: D1Database, origins?: BannerOrigins): Promise<Banner> {
  return projectBanner(await readBannerState(db), origins);
}

export async function getSiteContent(db: D1Database): Promise<unknown> {
  const row = await db
    .prepare("SELECT value FROM site_settings WHERE key = ?")
    .bind("site_content")
    .first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return null;
  }
}

export async function getCommunityInviteUrl(db: D1Database): Promise<string> {
  const content = await getSiteContent(db);
  if (content && typeof content === "object" && "communityInviteUrl" in content) {
    const raw = (content as { communityInviteUrl?: unknown }).communityInviteUrl;
    if (typeof raw === "string") {
      const parsed = parseDiscordInviteUrl(raw);
      if (parsed.ok && parsed.value) return parsed.value;
    }
  }
  return DEFAULT_COMMUNITY_INVITE_URL;
}

export async function listRecommendations(db: D1Database, publicAssetsBaseUrl?: string): Promise<Recommendation[]> {
  const rows = await db
    .prepare(`
    SELECT r.id, r.curator_id, r.project_id, r.comment, r.project_version_id,
           COALESCE(u.global_name, u.username) AS curator_name, u.avatar AS curator_avatar
    FROM recommendations r
    JOIN users u ON u.id = r.curator_id
    JOIN projects p ON p.id=r.project_id AND p.published_version_id=r.project_version_id
      AND p.visibility='public' AND p.deleted_at IS NULL
    ORDER BY r.updated_at DESC
    LIMIT 20
  `)
    .all<RecommendationRow>();

  const projects = await getPublishedProjectsByIds(
    db,
    rows.results.map((row) => row.project_id),
    publicAssetsBaseUrl,
  );
  return rows.results.flatMap((row) => {
    const project = projects.get(row.project_id);
    if (!project || project.publishedVersionId !== row.project_version_id) return [];
    return [
      {
        id: row.id,
        curator: {
          id: row.curator_id,
          name: row.curator_name,
          avatarUrl: row.curator_avatar
            ? `https://cdn.discordapp.com/avatars/${row.curator_id}/${row.curator_avatar}.png`
            : null,
        },
        comment: row.comment,
        projectVersionId: row.project_version_id,
        project,
      },
    ];
  });
}

export async function getDiscovery(db: D1Database, publicAssetsBaseUrl?: string) {
  const batch = await readRecommendationBatch(db, undefined, publicAssetsBaseUrl);
  return {
    batchId: batch?.batchId ?? null,
    scheduledAt: batch?.scheduledAt ?? null,
    items: batch?.items.map((item) => ({ ...item.project, recommendations: item.recommendations })) ?? [],
  };
}

export async function getHome(db: D1Database, origins?: BannerOrigins): Promise<HomeResponse> {
  const [site, discovery, projects] = await Promise.allSettled([
    Promise.all([getBanner(db, origins), getSiteContent(db)]).then(([banner, siteContent]) =>
      siteSettingsSchema.parse({ banner, siteContent }),
    ),
    getDiscovery(db, origins?.PUBLIC_ASSETS_BASE_URL),
    listPublishedProjects(
      db,
      {
        limit: 25,
        sort: "updated",
        period: "all",
        projectType: [],
        tag: [],
        includeContained: false,
      },
      origins?.PUBLIC_ASSETS_BASE_URL,
    ),
  ]);
  function section<T>(result: PromiseSettledResult<T>, message: string) {
    if (result.status === "fulfilled") return { ok: true as const, data: result.value };
    if (isStorageQuotaError(result.reason)) {
      return {
        ok: false as const,
        error: {
          code: "quota_exceeded" as const,
          message: quotaExceededMessage(),
          details: quotaErrorDetail(result.reason),
        },
      };
    }
    return { ok: false as const, error: { code: "internal" as const, message } };
  }
  return {
    site: section(site, "Site unavailable"),
    discovery: section(discovery, "Discovery unavailable"),
    projects: section(projects, "Projects unavailable"),
  };
}
