import {
  bannerSchema,
  type Banner,
  type Recommendation,
} from "@workshop/contracts";
import { getPublishedProjectsByIds, listPublishedProjects } from "./projects.js";

interface RecommendationRow {
  id: string;
  curator_id: string;
  project_id: string;
  comment: string;
  reaction: string;
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

export async function getBanner(db: D1Database): Promise<Banner> {
  const row = await db.prepare("SELECT value FROM site_settings WHERE key = ?")
    .bind("discover_banner")
    .first<{ value: string }>();
  if (!row) return DEFAULT_BANNER;
  try {
    return bannerSchema.parse(JSON.parse(row.value));
  } catch {
    return DEFAULT_BANNER;
  }
}

export async function getSiteContent(db: D1Database): Promise<unknown> {
  const row = await db.prepare("SELECT value FROM site_settings WHERE key = ?")
    .bind("site_content").first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return null;
  }
}

export async function listRecommendations(db: D1Database): Promise<Recommendation[]> {
  const rows = await db.prepare(`
    SELECT r.id, r.curator_id, r.project_id, r.comment, r.reaction,
           COALESCE(u.global_name, u.username) AS curator_name, u.avatar AS curator_avatar
    FROM recommendations r
    JOIN users u ON u.id = r.curator_id
    ORDER BY r.updated_at DESC
    LIMIT 20
  `).all<RecommendationRow>();

  const projects = await getPublishedProjectsByIds(db, rows.results.map(row => row.project_id));
  return rows.results.flatMap(row => {
    const project = projects.get(row.project_id);
    if (!project) return [];
    return [{
      id: row.id,
      curator: {
        id: row.curator_id,
        name: row.curator_name,
        avatarUrl: row.curator_avatar
          ? `https://cdn.discordapp.com/avatars/${row.curator_id}/${row.curator_avatar}.png`
          : null,
      },
      comment: row.comment,
      reaction: row.reaction,
      project,
    }];
  });
}

export async function getHome(db: D1Database) {
  const [banner, latest, recommendations] = await Promise.all([
    getBanner(db),
    listPublishedProjects(db, { limit: 6, sort: "updated" }),
    listRecommendations(db),
  ]);
  return {
    banner,
    latest: latest.items,
    recommendations: recommendations.slice(0, 4).map(item => item.project),
  };
}
