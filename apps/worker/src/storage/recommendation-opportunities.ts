import { type RecommendationBatchResult, recommendationBatchResultSchema } from "@workshop/contracts";
import { estimateOpportunities, type OpportunityBatch, type OpportunityInterval } from "@workshop/domain";

interface ActivationRow {
  batch_id: string;
  activated_at: string;
  activation_ended_at: string | null;
  replaced_at: string | null;
  display_start_at: string;
  display_end_at: string;
  status: string;
  result: string | null;
  hourly_mean: string | null;
}

interface EligibilityRow {
  batch_id: string;
  project_id: string;
  project_version_id: string;
  ended_at: string | null;
}

interface MissingActivationRow {
  batch_id: string;
}

// Include the last predecessor, even if it has stopped displaying: no earlier batch
// can resume after it. Compute replacement before discarding non-overlapping rows.
const overlappingActivations = `WITH bounded AS (
  SELECT * FROM (
    SELECT rowid AS activation_order, batch_id, hourly_mean, activated_at, ended_at
    FROM recommendation_batch_activations WHERE activated_at<?
    ORDER BY activated_at DESC, rowid DESC LIMIT 1
  )
  UNION ALL
  SELECT rowid, batch_id, hourly_mean, activated_at, ended_at
  FROM recommendation_batch_activations WHERE activated_at>=? AND activated_at<?
), sequenced AS (
  SELECT *, LEAD(activated_at) OVER (ORDER BY activated_at, activation_order) AS replaced_at
  FROM bounded
), overlapping AS (
  SELECT a.*, b.display_start_at, b.display_end_at, b.status, b.result
  FROM sequenced a JOIN recommendation_batches b ON b.id=a.batch_id
  WHERE b.display_start_at<? AND b.display_end_at>?
    AND a.activated_at<b.display_end_at
    AND (a.ended_at IS NULL OR a.ended_at>?)
    AND (a.replaced_at IS NULL OR a.replaced_at>?)
    AND (a.replaced_at IS NULL OR a.replaced_at>a.activated_at)
    AND (a.ended_at IS NULL OR a.ended_at>a.activated_at)
    AND (a.replaced_at IS NULL OR a.replaced_at>b.display_start_at)
    AND (a.ended_at IS NULL OR a.ended_at>b.display_start_at)
)
`;

type Eligibility = Map<string, Map<string, { version: string; end: number | null }>>;

function parseBatchResult(row: ActivationRow): RecommendationBatchResult | null {
  if (row.status !== "complete" || row.result === null) return null;
  try {
    return recommendationBatchResultSchema.parse(JSON.parse(row.result));
  } catch {
    // A damaged result cannot establish which projects were displayed.
    return null;
  }
}

function parseProfile(value: string | null): readonly (number | null)[] | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // A damaged profile is unknown, not zero traffic.
    return null;
  }
}

function accountBatch(
  row: ActivationRow,
  parsed: RecommendationBatchResult,
  eligibility: Eligibility,
  totals: Map<string, number | null>,
  window: OpportunityInterval,
): void {
  const batch: OpportunityBatch = {
    id: row.batch_id,
    activatedAt: Date.parse(row.activated_at),
    displayStart: Date.parse(row.display_start_at),
    displayEnd: Date.parse(row.display_end_at),
    failedAt: row.activation_ended_at === null ? null : Date.parse(row.activation_ended_at),
    replacedAt: row.replaced_at === null ? null : Date.parse(row.replaced_at),
    eligibilityEnd: null,
    eligibilityKnown: true,
    hourlyProfile: parseProfile(row.hourly_mean),
  };
  for (const item of parsed.items) {
    if (!totals.has(item.project_id)) continue;
    const evidence = eligibility.get(row.batch_id)?.get(item.project_id);
    const known =
      evidence !== undefined &&
      evidence.version === item.project_version_id &&
      (evidence.end === null || Number.isFinite(evidence.end));
    const [estimate] = estimateOpportunities(
      [{ ...batch, eligibilityKnown: known, eligibilityEnd: known ? evidence.end : null }],
      window,
    );
    if (!estimate) continue;
    const current = totals.get(item.project_id)!;
    totals.set(
      item.project_id,
      current === null || estimate.estimatedOpportunity === null ? null : current + estimate.estimatedOpportunity,
    );
  }
}

/**
 * Historical estimated Worker requests for each project over a half-open interval.
 * Null means the history cannot establish an estimate; it is never treated as zero.
 */
export async function loadEstimatedOpportunities(
  db: D1Database,
  projectIds: readonly string[],
  window: OpportunityInterval,
): Promise<Map<string, number | null>> {
  const totals = new Map<string, number | null>(projectIds.map((id) => [id, 0]));
  if (totals.size === 0) return totals;
  const end = new Date(window.end).toISOString();
  if (window.start === window.end) return totals;
  const start = new Date(window.start).toISOString();
  const bounds = [start, start, end, end, start, start, start];
  const [activationResult, eligibilityResult, missingResult] = await db.batch<
    ActivationRow | EligibilityRow | MissingActivationRow
  >([
    db
      .prepare(`${overlappingActivations}
      SELECT a.batch_id,a.activated_at,a.ended_at AS activation_ended_at,a.replaced_at,
        a.display_start_at,a.display_end_at,a.status,a.result,a.hourly_mean
      FROM overlapping a
      ORDER BY a.activated_at,a.activation_order`)
      .bind(...bounds),
    db
      .prepare(`${overlappingActivations}
      SELECT e.batch_id,e.project_id,e.project_version_id,e.ended_at
      FROM overlapping a JOIN recommendation_batch_eligibility e ON e.batch_id=a.batch_id`)
      .bind(...bounds),
    db
      .prepare(`SELECT b.id AS batch_id FROM recommendation_batches b
      LEFT JOIN recommendation_batch_activations a ON a.batch_id=b.id
      WHERE b.kind='discovery' AND b.status='complete' AND a.batch_id IS NULL
      AND b.display_start_at<? AND b.display_end_at>? LIMIT 1`)
      .bind(end, start),
  ]);
  if (missingResult!.results.length) {
    for (const id of totals.keys()) totals.set(id, null);
    return totals;
  }

  const eligibility: Eligibility = new Map();
  for (const row of eligibilityResult!.results as EligibilityRow[]) {
    if (!totals.has(row.project_id)) continue;
    let members = eligibility.get(row.batch_id);
    if (!members) {
      members = new Map();
      eligibility.set(row.batch_id, members);
    }
    members.set(row.project_id, {
      version: row.project_version_id,
      end: row.ended_at === null ? null : Date.parse(row.ended_at),
    });
  }

  for (const row of activationResult!.results as ActivationRow[]) {
    const parsed = parseBatchResult(row);
    if (parsed === null) {
      for (const id of totals.keys()) totals.set(id, null);
      return totals;
    }
    accountBatch(row, parsed, eligibility, totals, window);
  }
  return totals;
}
