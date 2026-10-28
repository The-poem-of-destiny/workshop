import { getPublishedProjectsByIds } from "./projects.js";

type RankingKind = "daily" | "7d" | "30d";

const DAY_MS = 86_400_000;

export async function buildRankings(db: D1Database, referenceTime: Date | number): Promise<void> {
  const reference = new Date(referenceTime);
  const referenceIso = reference.toISOString();
  const today = referenceIso.slice(0, 10);
  const kinds: Array<{ kind: RankingKind; days: number }> = [
    { kind: "daily", days: 1 },
    { kind: "7d", days: 7 },
    { kind: "30d", days: 30 },
  ];

  for (const { kind, days } of kinds) {
    const hour = referenceIso.slice(11, 13);
    const bucket = kind === "daily" ? `${today}T${hour}` : `${today}:${days}d`;
    const previous = await db
      .prepare(`
        SELECT id FROM ranking_runs
        WHERE kind = ? AND status = 'complete'
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .bind(kind)
      .first<{ id: string }>();
    const runId = crypto.randomUUID();
    await db
      .prepare(`
        INSERT INTO ranking_runs (id, kind, bucket, status, created_at)
        VALUES (?, ?, ?, 'building', ?)
      `)
      .bind(runId, kind, `${bucket}:building:${runId}`, referenceIso)
      .run();

    const rows = await db
      .prepare(`
        SELECT p.id AS project_id, COALESCE(SUM(m.downloads + m.likes_delta * 3), 0) AS score
        FROM projects p
        LEFT JOIN project_metrics_daily m
          ON m.project_id = p.id AND m.day_key >= ? AND m.day_key <= ?
        WHERE p.visibility = 'public' AND p.published_revision_id IS NOT NULL AND p.deleted_at IS NULL
        GROUP BY p.id
        ORDER BY score DESC, p.updated_at DESC
        LIMIT 50
      `)
      .bind(new Date(reference.getTime() - Math.max(0, days - 1) * DAY_MS).toISOString().slice(0, 10), today)
      .all<{ project_id: string; score: number }>();

    if (rows.results.length > 0) {
      await db.batch(
        rows.results.map((row, index) =>
          db
            .prepare("INSERT INTO ranking_entries (run_id, rank, project_id, score) VALUES (?, ?, ?, ?)")
            .bind(runId, index + 1, row.project_id, row.score),
        ),
      );
    }

    // This batch is the visibility boundary: it retires the observed complete
    // run and publishes this candidate together, so only one contender wins.
    const finalize: D1PreparedStatement[] = [];
    if (previous) {
      finalize.push(
        db
          .prepare(`
            UPDATE ranking_runs
            SET status = 'building', bucket = bucket || ':replaced:' || id
            WHERE kind = ? AND status = 'complete'
              AND EXISTS (
                SELECT 1 FROM ranking_runs AS observed
                WHERE observed.id = ? AND observed.kind = ? AND observed.status = 'complete'
              )
          `)
          .bind(kind, previous.id, kind),
      );
    }
    const completedIndex = finalize.length;
    finalize.push(
      db
        .prepare(`
          UPDATE ranking_runs
          SET status = 'complete', bucket = ?, completed_at = ?
          WHERE id = ? AND status = 'building'
            AND NOT EXISTS (
              SELECT 1 FROM ranking_runs
              WHERE kind = ? AND status = 'complete'
            )
        `)
        .bind(bucket, referenceIso, runId, kind),
    );
    if (kind === "daily") {
      finalize.push(
        db
          .prepare(`
            DELETE FROM discovery_exposures
            WHERE bucket = ?
              AND EXISTS (
                SELECT 1 FROM ranking_runs
                WHERE id = ? AND kind = ? AND bucket = ? AND status = 'complete'
              )
          `)
          .bind(bucket, runId, kind, bucket),
      );
      for (const [index, row] of rows.results.slice(0, 8).entries()) {
        finalize.push(
          db
            .prepare(`
              INSERT INTO discovery_exposures (bucket, project_id, rank, created_at)
              SELECT ?, ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM ranking_runs
                WHERE id = ? AND kind = ? AND bucket = ? AND status = 'complete'
              )
            `)
            .bind(bucket, row.project_id, index + 1, referenceIso, runId, kind, bucket),
        );
      }
    }
    const results = await db.batch(finalize);
    if ((results[completedIndex]?.meta.changes ?? 0) === 0) {
      await db.prepare("DELETE FROM ranking_runs WHERE id = ? AND status = 'building'").bind(runId).run();
    }
  }
}

export async function cleanupExpired(
  db: D1Database,
  dryRun = false,
  referenceTime: Date | number = new Date(),
): Promise<Record<string, number>> {
  const now = new Date(referenceTime).getTime();
  const iso = new Date(now).toISOString();
  const weekAgo = new Date(now - 7 * DAY_MS).toISOString();
  const dayAgo = new Date(now - DAY_MS).toISOString();
  const ninetyDaysAgo = new Date(now - 90 * DAY_MS).toISOString();
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
