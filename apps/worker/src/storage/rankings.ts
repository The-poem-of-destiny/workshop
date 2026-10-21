import { getPublishedProjectsByIds } from "./projects.js";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bucketStart(days: number): string {
  return new Date(Date.now() - Math.max(0, days - 1) * 86_400_000).toISOString().slice(0, 10);
}

export async function buildRankings(db: D1Database): Promise<void> {
  const today = dayKey(new Date());
  const kinds: Array<{ kind: "daily" | "7d" | "30d"; days: number }> = [
    { kind: "daily", days: 1 },
    { kind: "7d", days: 7 },
    { kind: "30d", days: 30 },
  ];

  for (const { kind, days } of kinds) {
    const hour = new Date().toISOString().slice(11, 13);
    const bucket = kind === "daily" ? `${today}T${hour}` : `${today}:${days}d`;
    const runId = crypto.randomUUID();
    await db
      .prepare(`
      INSERT INTO ranking_runs (id, kind, bucket, status, created_at)
      VALUES (?, ?, ?, 'building', ?)
      ON CONFLICT(kind, bucket) DO UPDATE SET status = 'building', created_at = excluded.created_at, completed_at = NULL
    `)
      .bind(runId, kind, bucket, new Date().toISOString())
      .run();
    const run = await db
      .prepare("SELECT id FROM ranking_runs WHERE kind = ? AND bucket = ?")
      .bind(kind, bucket)
      .first<{ id: string }>();
    if (!run) continue;
    await db.prepare("DELETE FROM ranking_entries WHERE run_id = ?").bind(run.id).run();

    const rows = await db
      .prepare(`
      SELECT p.id AS project_id, COALESCE(SUM(m.downloads + m.likes_delta * 3), 0) AS score
      FROM projects p
      LEFT JOIN project_metrics_daily m
        ON m.project_id = p.id AND m.day_key >= ?
      WHERE p.visibility = 'public' AND p.published_revision_id IS NOT NULL AND p.deleted_at IS NULL
      GROUP BY p.id
      ORDER BY score DESC, p.updated_at DESC
      LIMIT 50
    `)
      .bind(bucketStart(days))
      .all<{ project_id: string; score: number }>();

    if (rows.results.length > 0) {
      await db.batch(
        rows.results.map((row, index) =>
          db
            .prepare("INSERT INTO ranking_entries (run_id, rank, project_id, score) VALUES (?, ?, ?, ?)")
            .bind(run.id, index + 1, row.project_id, row.score),
        ),
      );
    }
    await db
      .prepare("UPDATE ranking_runs SET status = 'complete', completed_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), run.id)
      .run();

    if (kind === "daily") {
      await db.prepare("DELETE FROM discovery_exposures WHERE bucket = ?").bind(bucket).run();
      await db.batch(
        rows.results
          .slice(0, 8)
          .map((row, index) =>
            db
              .prepare("INSERT OR REPLACE INTO discovery_exposures (bucket, project_id, rank) VALUES (?, ?, ?)")
              .bind(bucket, row.project_id, index + 1),
          ),
      );
    }
  }
}

export async function cleanupExpired(db: D1Database, dryRun = false): Promise<Record<string, number>> {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const ninetyDaysAgo = new Date(now - 90 * 86_400_000).toISOString();
  if (dryRun) {
    const row = await db
      .prepare("SELECT COUNT(*) AS count FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?")
      .bind(ninetyDaysAgo)
      .first<{ count: number }>();
    return { deletedProjects: row?.count ?? 0 };
  }
  await db.batch([
    db
      .prepare("DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)")
      .bind(iso, weekAgo),
    db
      .prepare("DELETE FROM oauth_flows WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)")
      .bind(dayAgo, weekAgo),
    db
      .prepare("DELETE FROM download_tokens WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)")
      .bind(dayAgo, weekAgo),
    db.prepare("DELETE FROM ranking_runs WHERE created_at < ?").bind(ninetyDaysAgo),
    db.prepare("DELETE FROM discovery_exposures WHERE created_at < ?").bind(ninetyDaysAgo),
    db.prepare("DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?").bind(ninetyDaysAgo),
  ]);
  return { deletedProjects: 0 };
}

export async function getRankings(db: D1Database, kind: "daily" | "7d" | "30d") {
  const run = await db
    .prepare(`
    SELECT id, bucket FROM ranking_runs
    WHERE kind = ? AND status = 'complete'
    ORDER BY created_at DESC LIMIT 1
  `)
    .bind(kind)
    .first<{ id: string; bucket: string }>();
  if (!run) return { kind, bucket: null, items: [] };
  const rows = await db
    .prepare(`
    SELECT project_id, rank, score FROM ranking_entries
    WHERE run_id = ? ORDER BY rank LIMIT 24
  `)
    .bind(run.id)
    .all<{ project_id: string; rank: number; score: number }>();
  const projects = await getPublishedProjectsByIds(
    db,
    rows.results.map((row) => row.project_id),
  );
  return {
    kind,
    bucket: run.bucket,
    items: rows.results.flatMap((row) => {
      const project = projects.get(row.project_id);
      return project ? [{ rank: row.rank, score: row.score, project }] : [];
    }),
  };
}
