#!/usr/bin/env node
/** Read-only distribution rehearsal against a locally frozen target SQLite snapshot. */
import { DatabaseSync } from "node:sqlite";
import { selectRecommendations } from "../packages/domain/src/recommendation.ts";

const [file, at = new Date().toISOString()] = process.argv.slice(2);
if (!file || !Number.isFinite(Date.parse(at)))
  throw new Error("Usage: node tools/analyze-recommendations.mjs SNAPSHOT.sqlite [UTC_TIME]");
const db = new DatabaseSync(file, { readOnly: true });
const end = at.slice(0, 10);
const start = new Date(Date.parse(`${end}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
const previous = new Date(Date.parse(`${start}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
const rows = db
  .prepare(`SELECT p.id,p.author_id,p.published_version_id,r.project_type,p.published_at,r.created_at,
 COALESCE(SUM(CASE WHEN m.day_key>=? THEN m.downloads ELSE 0 END),0) downloads,
 COALESCE(SUM(CASE WHEN m.day_key>=? THEN m.likes_delta ELSE 0 END),0) likes,
 COALESCE(SUM(CASE WHEN m.day_key<? THEN m.downloads ELSE 0 END),0) previous
 FROM projects p JOIN project_versions r ON r.id=p.published_version_id AND r.project_id=p.id
 LEFT JOIN project_metrics_daily m ON m.project_id=p.id AND m.day_key>=? AND m.day_key<=?
 WHERE p.visibility='public' AND p.deleted_at IS NULL GROUP BY p.id ORDER BY p.id`)
  .all(start, start, start, previous, end);
const candidates = rows.map((r) => ({
  projectId: r.id,
  projectVersionId: r.published_version_id,
  authorId: r.author_id,
  projectType: r.project_type,
  publishedAt: r.published_at,
  updatedAt: r.created_at,
  downloads: r.downloads,
  likesDelta: r.likes,
  previousDownloads: r.previous,
  estimatedOpportunity: null,
  endorsements: [],
}));
const endorsements = db
  .prepare(
    `SELECT rec.curator_id,rec.project_version_id,rec.project_id,rec.created_at AS updated_at FROM recommendations rec JOIN projects p ON p.id=rec.project_id WHERE rec.project_version_id=p.published_version_id AND rec.curator_id<>p.author_id AND rec.created_at>=?`,
  )
  .all(new Date(Date.parse(at) - 90 * 86400000).toISOString());
const byId = new Map(candidates.map((c) => [c.projectId, c]));
for (const r of endorsements)
  byId
    .get(r.project_id)
    ?.endorsements.push({ userId: r.curator_id, projectVersionId: r.project_version_id, updatedAt: r.updated_at });
const windowStart = `${start}T00:00:00.000Z`;
const windowEnd = new Date(Date.parse(`${end}T00:00:00Z`) + 86400000).toISOString();
const changes = new Map(
  db
    .prepare(
      `SELECT project_version_id,changed_entries,total_entries,reported_at FROM project_change_signals WHERE reported_at>=? AND reported_at<?`,
    )
    .all(windowStart, windowEnd)
    .map((r) => [r.project_version_id, r]),
);
for (const candidate of candidates) {
  const change = changes.get(candidate.projectVersionId);
  candidate.contentChange = change
    ? { changedEntries: change.changed_entries, totalEntries: change.total_entries, reportedAt: change.reported_at }
    : null;
}
db.close();
const head = new Set(
  [...candidates]
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, Math.ceil(candidates.length * 0.1))
    .map((c) => c.projectId),
);
const output = [];
for (const temperature of [0.3, 0.7, 1.2]) {
  let seed = 20261102;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const projects = new Map(),
    authors = new Map(),
    categories = new Map(),
    pools = new Map();
  let selections = 0,
    headSelections = 0,
    maxAuthorPerRun = 0;
  for (let i = 0; i < 1000; i++) {
    const result = selectRecommendations(candidates, {
      now: Date.parse(at),
      random,
      limit: 12,
      authorCap: 2,
      temperature,
      budget: { verified: 0.3, hot: 0.25, new: 0.2, underexposed: 0.25 },
    });
    const perAuthor = new Map();
    for (const item of result) {
      const c = byId.get(item.projectId);
      selections++;
      headSelections += Number(head.has(c.projectId));
      for (const [map, key] of [
        [projects, c.projectId],
        [authors, c.authorId],
        [categories, c.projectType],
        [pools, item.pool],
      ])
        map.set(key, (map.get(key) ?? 0) + 1);
      perAuthor.set(c.authorId, (perAuthor.get(c.authorId) ?? 0) + 1);
    }
    maxAuthorPerRun = Math.max(maxAuthorPerRun, ...perAuthor.values());
  }
  output.push({
    temperature,
    selections,
    uniqueProjects: projects.size,
    uniqueAuthors: authors.size,
    maxProjectShare: selections ? Math.max(...projects.values()) / selections : 0,
    downloadHeadShare: selections ? headSelections / selections : 0,
    maxAuthorPerRun,
    categories: Object.fromEntries(categories),
    pools: Object.fromEntries(pools),
  });
}
console.log(
  JSON.stringify(
    {
      sourceWindow: { start, endInclusive: end },
      candidates: candidates.length,
      signals: {
        contentChangeVersions: changes.size,
        estimatedOpportunity: "unknown; traffic source not configured",
      },
      simulationsPerPolicy: 1000,
      scheduledBatchesPerDay: 24,
      estimatedBaseBatchRowMutationsPerDay: 48,
      policies: output,
    },
    null,
    2,
  ),
);
