export const recommendationPools = ["verified", "hot", "new", "underexposed"] as const;
export type RecommendationPool = (typeof recommendationPools)[number];

export interface RecommendationCandidate {
  projectId: string;
  projectVersionId: string;
  authorId: string;
  projectType: string;
  publishedAt: string;
  updatedAt: string;
  downloads: number;
  likesDelta: number;
  previousDownloads: number | null;
  estimatedOpportunity: number | null;
  contentChange?: { changedEntries: number; totalEntries: number; reportedAt: string } | null;
  endorsements: ReadonlyArray<{ userId: string; projectVersionId: string; updatedAt: string }>;
}

export interface RecommendationSelectionOptions {
  now: number;
  random: () => number;
  limit: number;
  authorCap: number;
  temperature: number;
  budget: Record<RecommendationPool, number>;
}

export interface RecommendationSelection {
  projectId: string;
  projectVersionId: string;
  pool: RecommendationPool;
  rank: number;
  score: number;
  contributions: {
    downloads: number;
    likes: number;
    trend: number;
    freshness: number;
    endorsements: number;
    contentChange: number;
    exposurePressure: number | null;
    categoryConfidence: number;
    categoryScarcity: number;
  };
}

const DAY = 86_400_000;
const clamp = (value: number, low = 0, high = 1): number => Math.min(high, Math.max(low, value));
const nonnegative = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);
const age = (value: string, now: number): number => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / DAY) : Number.POSITIVE_INFINITY;
};

function validateSelectionOptions(options: RecommendationSelectionOptions): void {
  if (!Number.isFinite(options.now)) throw new Error("Recommendation time must be finite");
  if (!Number.isInteger(options.limit) || options.limit < 0 || options.limit > 200) {
    throw new Error("Recommendation limit must be an integer between 0 and 200");
  }
  if (!Number.isInteger(options.authorCap) || options.authorCap < 1) {
    throw new Error("Recommendation author cap must be positive");
  }
  if (!Number.isFinite(options.temperature) || options.temperature < 0.1 || options.temperature > 4) {
    throw new Error("Recommendation temperature must be between 0.1 and 4");
  }
  let total = 0;
  for (const pool of recommendationPools) {
    if (!Number.isFinite(options.budget[pool]) || options.budget[pool] < 0) {
      throw new Error("Recommendation pool budgets must be finite and nonnegative");
    }
    total += options.budget[pool];
  }
  if (!Number.isFinite(total) || total <= 0) throw new Error("Recommendation pool budget must be positive and finite");
}

function uniqueCandidates(candidates: readonly RecommendationCandidate[]): RecommendationCandidate[] {
  const unique = new Map<string, RecommendationCandidate>();
  for (const candidate of candidates) {
    if (!candidate.projectId || !candidate.projectVersionId || !candidate.authorId) continue;
    // Conflicting duplicate versions are an invalid candidate snapshot, not extra lottery tickets.
    const previous = unique.get(candidate.projectId);
    if (previous && previous.projectVersionId !== candidate.projectVersionId) {
      throw new Error("Recommendation snapshot contains conflicting project versions");
    }
    if (!previous) unique.set(candidate.projectId, candidate);
  }
  const values = [...unique.values()];
  return values;
}

function categoryStatistics(values: RecommendationCandidate[]) {
  const categories = new Map<string, RecommendationCandidate[]>();
  for (const candidate of values) {
    const group = categories.get(candidate.projectType);
    if (group) group.push(candidate);
    else categories.set(candidate.projectType, [candidate]);
  }
  // An incomplete opportunity history cannot establish relative underrepresentation.
  const opportunityKnown = values.every(
    (candidate) =>
      candidate.estimatedOpportunity !== null &&
      Number.isFinite(candidate.estimatedOpportunity) &&
      candidate.estimatedOpportunity >= 0,
  );
  const categoryOpportunity = new Map<string, number>();
  let totalOpportunity = 0;
  if (opportunityKnown) {
    for (const candidate of values) {
      const opportunity = candidate.estimatedOpportunity!;
      categoryOpportunity.set(
        candidate.projectType,
        (categoryOpportunity.get(candidate.projectType) ?? 0) + opportunity,
      );
      totalOpportunity += opportunity;
    }
  }
  const percentiles = new Map<string, number>();
  for (const peers of categories.values()) {
    peers.sort((left, right) => nonnegative(left.downloads) - nonnegative(right.downloads));
    let firstEqual = 0;
    for (let index = 0; index < peers.length; index++) {
      const peer = peers[index]!;
      if (index === 0 || nonnegative(peer.downloads) !== nonnegative(peers[index - 1]!.downloads)) firstEqual = index;
      percentiles.set(peer.projectId, firstEqual / peers.length);
    }
  }
  return { categories, categoryOpportunity, totalOpportunity, percentiles };
}

type ScoredCandidate = {
  candidate: RecommendationCandidate;
  pool: RecommendationPool;
  score: number;
  contributions: RecommendationSelection["contributions"];
};

function drawRecommendations(
  scored: ScoredCandidate[],
  options: RecommendationSelectionOptions,
  budgetTotal: number,
): RecommendationSelection[] {
  const selected: RecommendationSelection[] = [];
  const authors = new Map<string, number>();
  const used = new Set<string>();
  const served: Record<RecommendationPool, number> = { verified: 0, hot: 0, new: 0, underexposed: 0 };
  while (selected.length < options.limit) {
    const eligible = scored.filter(
      ({ candidate }) => !used.has(candidate.projectId) && (authors.get(candidate.authorId) ?? 0) < options.authorCap,
    );
    if (eligible.length === 0) break;
    // Deficits redistribute exhausted pools without scanning unbounded fallback attempts.
    let chosenPool: RecommendationPool | null = null;
    let largestDeficit = Number.NEGATIVE_INFINITY;
    for (const pool of recommendationPools) {
      if (!eligible.some((item) => item.pool === pool)) continue;
      const deficit = ((selected.length + 1) * options.budget[pool]) / budgetTotal - served[pool];
      if (deficit > largestDeficit) {
        largestDeficit = deficit;
        chosenPool = pool;
      }
    }
    const poolValues = eligible.filter((item) => item.pool === chosenPool);
    const maxScore = Math.max(...poolValues.map((item) => item.score));
    const softmax = poolValues.map((item) => Math.exp((item.score - maxScore) / options.temperature));
    const softmaxTotal = softmax.reduce((total, weight) => total + weight, 0);
    const typeCounts = new Map<string, number>();
    for (const { candidate } of poolValues) {
      typeCounts.set(candidate.projectType, (typeCounts.get(candidate.projectType) ?? 0) + 1);
    }
    // Reserve 10% of each pool draw for equal-probability category exploration.
    const weights = poolValues.map(
      (item, index) =>
        (0.9 * softmax[index]!) / softmaxTotal + 0.1 / (typeCounts.size * typeCounts.get(item.candidate.projectType)!),
    );
    const sample = options.random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
      throw new Error("Recommendation random must be in [0,1)");
    let remainder = sample * weights.reduce((total, weight) => total + weight, 0);
    let index = poolValues.length - 1;
    for (let current = 0; current < weights.length; current++) {
      remainder -= weights[current] ?? 0;
      if (remainder < 0) {
        index = current;
        break;
      }
    }
    const item = poolValues[index];
    if (!item) break;
    used.add(item.candidate.projectId);
    authors.set(item.candidate.authorId, (authors.get(item.candidate.authorId) ?? 0) + 1);
    served[item.pool]++;
    selected.push({
      projectId: item.candidate.projectId,
      projectVersionId: item.candidate.projectVersionId,
      pool: item.pool,
      rank: selected.length + 1,
      score: item.score,
      contributions: item.contributions,
    });
  }
  return selected;
}

/** Pure selection: callers supply authorized, current-version candidates and estimated opportunities. */
export function selectRecommendations(
  candidates: readonly RecommendationCandidate[],
  options: RecommendationSelectionOptions,
): RecommendationSelection[] {
  if (candidates.length > 5000) throw new Error("Recommendation candidate snapshot exceeds 5000 projects");
  validateSelectionOptions(options);
  const budgetTotal = recommendationPools.reduce((total, pool) => total + options.budget[pool], 0);
  const values = uniqueCandidates(candidates);
  const { categories, categoryOpportunity, totalOpportunity, percentiles } = categoryStatistics(values);
  const scored = values.map((candidate) => {
    const peers = categories.get(candidate.projectType) ?? [];
    const percentile = percentiles.get(candidate.projectId) ?? 0;
    const categoryConfidence = peers.length / (peers.length + 10);
    const downloads = clamp(Math.log1p(nonnegative(candidate.downloads)) / 12);
    const likes = clamp(Math.log1p(nonnegative(candidate.likesDelta)) / 6);
    const trend =
      candidate.previousDownloads === null
        ? 0
        : clamp(Math.log1p(nonnegative(candidate.downloads) / (nonnegative(candidate.previousDownloads) + 10)) / 3);
    const freshness = Math.exp(-age(candidate.publishedAt, options.now) / 14);
    const validEndorsers = new Set(
      candidate.endorsements
        .filter(
          (endorsement) =>
            endorsement.userId !== candidate.authorId &&
            endorsement.projectVersionId === candidate.projectVersionId &&
            age(endorsement.updatedAt, options.now) <= 90,
        )
        .map((endorsement) => endorsement.userId),
    );
    const endorsements = Math.min(0.08, Math.log1p(validEndorsers.size) * 0.02);
    const exposurePressure =
      candidate.estimatedOpportunity === null ||
      !Number.isFinite(candidate.estimatedOpportunity) ||
      candidate.estimatedOpportunity < 0
        ? null
        : clamp(Math.log1p(candidate.estimatedOpportunity) / 12);
    const categoryScarcity =
      totalOpportunity > 0
        ? clamp(
            peers.length / values.length - (categoryOpportunity.get(candidate.projectType) ?? 0) / totalOpportunity,
            0,
            0.05,
          )
        : 0;
    const change = candidate.contentChange;
    const contentChange =
      change && change.changedEntries > 0 && change.totalEntries >= change.changedEntries
        ? Math.min(0.03, (change.changedEntries / Math.max(1, change.totalEntries)) * 0.03) *
          Math.exp(-age(change.reportedAt, options.now) / 30)
        : 0;
    const contributions = {
      downloads,
      likes,
      trend,
      freshness,
      endorsements,
      contentChange,
      exposurePressure,
      categoryConfidence,
      categoryScarcity,
    };
    const verified = downloads * 0.55 + likes * 0.25 + percentile * categoryConfidence * 0.12;
    const pool: RecommendationPool =
      age(candidate.publishedAt, options.now) < 14
        ? "new"
        : trend > 0.25 && candidate.downloads >= 10
          ? "hot"
          : verified >= 0.3
            ? "verified"
            : "underexposed";
    const base =
      pool === "new"
        ? freshness * 0.7 + downloads * 0.1
        : pool === "hot"
          ? trend * 0.6 + downloads * 0.2
          : pool === "verified"
            ? verified
            : (1 - downloads) * 0.45 + (1 - (exposurePressure ?? 0.5)) * 0.3;
    const pressureStrength = pool === "hot" ? 0.05 : pool === "new" ? 0.1 : 0.2;
    const score = clamp(
      base + endorsements + contentChange + categoryScarcity - (exposurePressure ?? 0) * pressureStrength,
    );
    return { candidate, pool, score, contributions };
  });
  return drawRecommendations(scored, options, budgetTotal);
}
