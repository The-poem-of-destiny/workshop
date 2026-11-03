import { type RecommendationRunResult, recommendationRunResultSchema } from "@workshop/contracts";
import { type RecommendationCandidate, selectRecommendations } from "@workshop/domain";
import { getPublishedProjectsByIds } from "./projects.js";
import { recommendationPolicy } from "./recommendation-policy";

type RankingKind = "daily" | "7d" | "30d";
const DAY_MS = 86_400_000;

interface CandidateRow {
  project_id: string;
  project_version_id: string;
  author_id: string;
  project_type: string;
  published_at: string;
  updated_at: string;
  downloads: number;
  likes_delta: number;
  previous_downloads: number;
}

interface EndorsementRow {
  id: string;
  project_id: string;
  project_version_id: string;
  curator_id: string;
  comment: string;
  updated_at: string;
}
async function endorsementSnapshot(db: D1Database, now: number, projectIds?: string[]) {
  if (projectIds?.length === 0) return new Map<string, EndorsementRow[]>();
  const scope = projectIds ? ` AND rec.project_id IN (${projectIds.map(() => "?").join(",")})` : "";
  const rows = await db
    .prepare(`SELECT rec.id,rec.project_id,rec.project_version_id,rec.curator_id,rec.comment,rec.created_at AS updated_at
    FROM recommendations rec JOIN projects p ON p.id=rec.project_id AND p.published_version_id=rec.project_version_id
    WHERE p.visibility='public' AND p.deleted_at IS NULL AND rec.curator_id<>p.author_id AND rec.created_at>=?
    ${scope} ORDER BY rec.id LIMIT 50001`)
    .bind(new Date(now - 90 * DAY_MS).toISOString(), ...(projectIds ?? []))
    .all<EndorsementRow>();
  if (rows.results.length > 50000) throw new Error("Recommendation endorsement snapshot exceeds 50000 rows");
  const byProject = new Map<string, EndorsementRow[]>();
  for (const row of rows.results) {
    const group = byProject.get(row.project_id) ?? [];
    group.push(row);
    byProject.set(row.project_id, group);
  }
  return byProject;
}

async function candidateSnapshot(db: D1Database, start: string, end: string, previous: string) {
  const rows = await db
    .prepare(`SELECT p.id AS project_id,p.published_version_id AS project_version_id,
    p.author_id,r.project_type,p.published_at,r.created_at AS updated_at,
    COALESCE(SUM(CASE WHEN m.day_key >= ? THEN m.downloads ELSE 0 END),0) AS downloads,
    COALESCE(SUM(CASE WHEN m.day_key >= ? THEN m.likes_delta ELSE 0 END),0) AS likes_delta,
    COALESCE(SUM(CASE WHEN m.day_key < ? THEN m.downloads ELSE 0 END),0) AS previous_downloads
    FROM projects p JOIN project_versions r ON r.id=p.published_version_id AND r.project_id=p.id
    LEFT JOIN project_metrics_daily m ON m.project_id=p.id AND m.day_key>=? AND m.day_key<?
    WHERE p.visibility='public' AND p.deleted_at IS NULL
    GROUP BY p.id ORDER BY p.id LIMIT 5001`)
    .bind(start, start, start, previous, end)
    .all<CandidateRow>();
  if (rows.results.length > 5000) throw new Error("Recommendation candidate snapshot exceeds 5000 projects");
  return rows.results.map(
    (row): RecommendationCandidate => ({
      projectId: row.project_id,
      projectVersionId: row.project_version_id,
      authorId: row.author_id,
      projectType: row.project_type,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
      downloads: row.downloads,
      likesDelta: row.likes_delta,
      previousDownloads: row.previous_downloads,
      impressions: null,
      endorsements: [],
    }),
  );
}

export async function buildRankings(
  db: D1Database,
  referenceTime: Date | number,
  configuration?: string,
): Promise<void> {
  const policy = recommendationPolicy(configuration);
  const reference = new Date(referenceTime);
  const scheduledAt = new Date(Math.floor(reference.getTime() / 3_600_000) * 3_600_000).toISOString();
  const displayEnd = new Date(Date.parse(scheduledAt) + 3_600_000).toISOString();
  const today = new Date(`${scheduledAt.slice(0, 10)}T00:00:00.000Z`).getTime();
  for (const [kind, days] of [
    ["daily", 1],
    ["7d", 7],
    ["30d", 30],
    ["discovery", 7],
  ] as const) {
    const start = new Date(today - (days - 1) * DAY_MS).toISOString();
    const end = new Date(today + DAY_MS).toISOString();
    const previous = new Date(Date.parse(start) - days * DAY_MS).toISOString();
    const runId = crypto.randomUUID();
    await db
      .prepare(`INSERT INTO recommendation_runs(id,kind,status,scheduled_at,display_start_at,display_end_at,source_start_at,source_end_at)
      VALUES(?,?,'building',?,?,?,?,?)`)
      .bind(runId, kind, scheduledAt, scheduledAt, displayEnd, start, end)
      .run();
    try {
      const candidates = await candidateSnapshot(db, start.slice(0, 10), end.slice(0, 10), previous.slice(0, 10));
      const signalRows = await db
        .prepare(`SELECT v.value AS project_id,COUNT(*)*16 AS impressions
        FROM recommendation_signals s JOIN recommendation_runs r ON r.id=s.run_id,json_each(s.visible_projects) v
        WHERE r.scheduled_at>=? AND r.scheduled_at<? GROUP BY v.value`)
        .bind(start, end)
        .all<{ project_id: string; impressions: number }>();
      const exposures = new Map(signalRows.results.map((row) => [row.project_id, row.impressions]));
      const changeRows = await db
        .prepare(
          `SELECT project_version_id,changed_entries,total_entries,reported_at FROM project_change_signals WHERE reported_at>=? AND reported_at<?`,
        )
        .bind(start, end)
        .all<{ project_version_id: string; changed_entries: number; total_entries: number; reported_at: string }>();
      const changes = new Map(changeRows.results.map((row) => [row.project_version_id, row]));
      for (const candidate of candidates) {
        candidate.impressions = exposures.get(candidate.projectId) ?? null;
        const change = changes.get(candidate.projectVersionId);
        candidate.contentChange = change
          ? {
              changedEntries: change.changed_entries,
              totalEntries: change.total_entries,
              reportedAt: change.reported_at,
            }
          : null;
      }
      const endorsements = await endorsementSnapshot(db, reference.getTime());
      for (const candidate of candidates)
        candidate.endorsements = (endorsements.get(candidate.projectId) ?? []).map((row) => ({
          userId: row.curator_id,
          projectVersionId: row.project_version_id,
          updatedAt: row.updated_at,
        }));
      const selected = selectRecommendations(candidates, {
        now: reference.getTime(),
        random: Math.random,
        limit: kind === "discovery" ? policy.discoveryLimit : policy.rankingLimit,
        authorCap: policy.authorCap,
        temperature: policy.temperature,
        budget: policy.budget,
      });
      const result = recommendationRunResultSchema.parse({
        schemaVersion: 1,
        scoringVersion: "four-pool-v1",
        items: selected.map((item) => ({
          project_id: item.projectId,
          project_version_id: item.projectVersionId,
          pool: item.pool,
          rank: item.rank,
          score: item.score,
          contributions: item.contributions,
          recommendations: (endorsements.get(item.projectId) ?? []).map((row) => ({
            id: row.id,
            user_id: row.curator_id,
            comment: row.comment,
            contribution: item.contributions.endorsements / (endorsements.get(item.projectId)?.length ?? 1),
          })),
        })),
      });
      await db
        .prepare("UPDATE recommendation_runs SET status='complete',result=? WHERE id=? AND status='building'")
        .bind(JSON.stringify(result), runId)
        .run();
    } catch (error) {
      await db
        .prepare("UPDATE recommendation_runs SET status='failed',error=? WHERE id=? AND status='building'")
        .bind(error instanceof Error ? error.message : String(error), runId)
        .run();
      throw error;
    }
  }
}

export async function readRecommendationRun(db: D1Database, kind: RankingKind | "discovery", now = Date.now()) {
  const iso = new Date(now).toISOString();
  const row = await db
    .prepare(`SELECT id,scheduled_at,display_start_at,display_end_at,result FROM recommendation_runs
    WHERE kind=? AND status='complete' AND display_start_at<=? AND display_end_at>?
    ORDER BY scheduled_at DESC,rowid DESC LIMIT 1`)
    .bind(kind, iso, iso)
    .first<{ id: string; scheduled_at: string; display_start_at: string; display_end_at: string; result: string }>();
  if (!row) return null;
  const result: RecommendationRunResult = recommendationRunResultSchema.parse(JSON.parse(row.result));
  const projects = await getPublishedProjectsByIds(
    db,
    result.items.map((item) => item.project_id),
  );
  const currentEndorsements = await endorsementSnapshot(
    db,
    now,
    result.items.map((item) => item.project_id),
  );
  return {
    runId: row.id,
    scheduledAt: row.scheduled_at,
    displayStartAt: row.display_start_at,
    displayEndAt: row.display_end_at,
    items: result.items.flatMap((item) => {
      const project = projects.get(item.project_id);
      const valid = (currentEndorsements.get(item.project_id) ?? []).filter(
        (rec) => rec.project_version_id === item.project_version_id && rec.comment.trim(),
      );
      const comment = valid.length ? valid[Math.floor(Math.random() * valid.length)]!.comment : null;
      return project?.publishedVersionId === item.project_version_id
        ? [{ ...item, project, recommendationComment: comment }]
        : [];
    }),
  };
}

export async function getRankings(db: D1Database, kind: RankingKind) {
  const run = await readRecommendationRun(db, kind);
  return {
    kind,
    scheduledAt: run?.scheduledAt ?? null,
    displayStartAt: run?.displayStartAt ?? null,
    displayEndAt: run?.displayEndAt ?? null,
    items: run?.items.map((item) => ({ rank: item.rank, score: item.score, project: item.project })) ?? [],
  };
}

export async function observeCleanupCandidates(db: D1Database, referenceTime: number) {
  const now = new Date(referenceTime).toISOString();
  const row = await db
    .prepare(`SELECT
    (SELECT COUNT(*) FROM projects WHERE deleted_at IS NOT NULL) AS soft_deleted_projects,
    (SELECT COUNT(*) FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL) AS expired_sessions,
    (SELECT COUNT(*) FROM oauth_flows WHERE expires_at < ? OR consumed_at IS NOT NULL) AS completed_flows,
    (SELECT COUNT(*) FROM assets a LEFT JOIN projects p ON p.id = a.project_id WHERE p.id IS NULL) AS orphan_asset_rows,
    (SELECT MIN(submitted_at) FROM submissions WHERE status IN ('pending', 'checking')) AS oldest_pending_at`)
    .bind(now, now)
    .first<{
      soft_deleted_projects: number;
      expired_sessions: number;
      completed_flows: number;
      orphan_asset_rows: number;
      oldest_pending_at: string | null;
    }>();
  return {
    observedAt: now,
    retentionPolicy: "undecided" as const,
    softDeletedProjects: row?.soft_deleted_projects ?? 0,
    expiredSessions: row?.expired_sessions ?? 0,
    completedFlows: row?.completed_flows ?? 0,
    orphanAssetRows: row?.orphan_asset_rows ?? 0,
    oldestPendingAt: row?.oldest_pending_at ?? null,
  };
}
