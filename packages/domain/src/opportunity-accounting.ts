export interface OpportunityInterval {
  /** Half-open interval in Unix milliseconds. */
  start: number;
  end: number;
}

export interface OpportunityBatch {
  id: string;
  activatedAt: number;
  displayStart: number;
  displayEnd: number;
  replacedAt: number | null;
  failedAt: number | null;
  eligibilityEnd: number | null;
  /** Whether eligibility is known throughout the effective interval before eligibilityEnd. */
  eligibilityKnown: boolean;
  /** Historical expected Worker requests for each UTC hour; null means unavailable. */
  hourlyProfile: readonly (number | null)[] | null;
}

export interface OpportunityEstimate extends OpportunityInterval {
  batchId: string;
  estimatedOpportunity: number | null;
}

const HOUR = 3_600_000;

/**
 * Account for one project's activated batches. Include every activation, even batches
 * that do not contain the project: an activation permanently supersedes its predecessor.
 * Callers must not credit results for batches that did not contain the project.
 */
export function estimateOpportunities(
  batches: readonly OpportunityBatch[],
  window: OpportunityInterval,
): OpportunityEstimate[] {
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end < window.start) {
    throw new Error("Invalid opportunity window");
  }
  const sorted = [...batches].sort((a, b) => a.activatedAt - b.activatedAt);
  const ids = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const batch = sorted[i]!;
    if (!batch.id || ids.has(batch.id)) throw new Error("Duplicate or empty opportunity batch ID");
    ids.add(batch.id);
    if (
      ![batch.activatedAt, batch.displayStart, batch.displayEnd].every(Number.isFinite) ||
      batch.displayEnd < batch.displayStart ||
      [batch.replacedAt, batch.failedAt, batch.eligibilityEnd].some((time) => time !== null && !Number.isFinite(time))
    ) {
      throw new Error("Invalid opportunity batch interval");
    }
  }

  const estimates: OpportunityEstimate[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const batch = sorted[i]!;
    const start = Math.max(window.start, batch.activatedAt, batch.displayStart);
    const end = Math.min(
      window.end,
      batch.displayEnd,
      sorted[i + 1]?.activatedAt ?? Infinity,
      batch.replacedAt ?? Infinity,
      batch.failedAt ?? Infinity,
      batch.eligibilityEnd ?? Infinity,
    );
    if (end <= start) continue;

    let estimatedOpportunity: number | null = 0;
    const profile = batch.hourlyProfile;
    if (!batch.eligibilityKnown || profile === null || profile.length !== 24) {
      estimatedOpportunity = null;
    } else {
      for (let cursor = start; cursor < end; ) {
        const hourStart = Math.floor(cursor / HOUR) * HOUR;
        const next = Math.min(end, hourStart + HOUR);
        const hour = ((Math.floor(hourStart / HOUR) % 24) + 24) % 24;
        const value = profile[hour];
        if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
          estimatedOpportunity = null;
          break;
        }
        estimatedOpportunity += value * ((next - cursor) / HOUR);
        cursor = next;
      }
    }
    estimates.push({ batchId: batch.id, start, end, estimatedOpportunity });
  }
  return estimates;
}
