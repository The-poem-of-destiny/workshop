import { describe, expect, it } from "vitest";
import { type RecommendationCandidate, selectRecommendations } from "./recommendation.js";

const now = Date.parse("2026-11-02T00:00:00Z");
const options = {
  now,
  random: () => 0.42,
  limit: 8,
  authorCap: 2,
  temperature: 0.5,
  budget: { verified: 30, hot: 25, new: 20, underexposed: 25 },
};
function candidate(id: number): RecommendationCandidate {
  return {
    projectId: `p${id}`,
    projectVersionId: `v${id}`,
    authorId: `a${Math.floor(id / 3)}`,
    projectType: "worldbook",
    publishedAt: "2026-10-31T00:00:00Z",
    updatedAt: "2026-10-31T00:00:00Z",
    downloads: 0,
    likesDelta: -10,
    previousDownloads: null,
    estimatedOpportunity: null,
    endorsements: [],
  };
}

describe("bounded recommendation selection", () => {
  it("redistributes exhausted pools while retaining project uniqueness and author limits", () => {
    const candidates = Array.from({ length: 15 }, (_, id) => candidate(id));
    const selected = selectRecommendations([...candidates, candidates[0]!], options);
    expect(selected).toHaveLength(8);
    expect(new Set(selected.map((item) => item.projectId)).size).toBe(8);
    const authorCounts: Record<string, number> = {};
    for (const item of selected) {
      const author = candidates.find((entry) => entry.projectId === item.projectId)!.authorId;
      authorCounts[author] = (authorCounts[author] ?? 0) + 1;
    }
    expect(Object.values(authorCounts).every((count) => count <= 2)).toBe(true);
    expect(selected.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(selected.every((item) => item.pool === "new")).toBe(true);
  });

  it("does not turn missing opportunity into measured zero or credit invalid endorsements", () => {
    const item = candidate(0);
    item.endorsements = [
      { userId: item.authorId, projectVersionId: item.projectVersionId, updatedAt: "2026-11-01T00:00:00Z" },
      { userId: "other", projectVersionId: "old", updatedAt: "2026-11-01T00:00:00Z" },
      { userId: "expired", projectVersionId: item.projectVersionId, updatedAt: "2025-01-01T00:00:00Z" },
    ];
    const first = selectRecommendations([item], options)[0]!;
    expect(first.contributions.exposurePressure).toBeNull();
    expect(first.contributions.endorsements).toBe(0);
    const endorsement = {
      userId: "reader",
      projectVersionId: item.projectVersionId,
      updatedAt: "2026-11-01T00:00:00Z",
    };
    item.endorsements = [endorsement, endorsement, endorsement];
    expect(selectRecommendations([item], options)[0]!.contributions.endorsements).toBeCloseTo(Math.log(2) * 0.02);
  });

  it("uses known opportunity to bound category scarcity and reduce repeat allocation", () => {
    const common = { ...candidate(0), projectType: "common", estimatedOpportunity: 1000 };
    const scarce = { ...candidate(3), projectType: "scarce", estimatedOpportunity: 0 };
    const results = selectRecommendations([common, scarce], { ...options, limit: 2 });
    const commonResult = results.find((item) => item.projectId === common.projectId)!;
    const scarceResult = results.find((item) => item.projectId === scarce.projectId)!;
    expect(scarceResult.contributions.categoryScarcity).toBe(0.05);
    expect(commonResult.contributions.categoryScarcity).toBe(0);
    expect(commonResult.contributions.exposurePressure).toBeGreaterThan(scarceResult.contributions.exposurePressure!);
    expect(scarceResult.score).toBeGreaterThan(commonResult.score);
    const unknown = selectRecommendations([common, { ...scarce, estimatedOpportunity: null }], {
      ...options,
      limit: 2,
    });
    expect(unknown.every((item) => item.contributions.categoryScarcity === 0)).toBe(true);
  });

  it("reserves exploration probability for a category with few eligible candidates", () => {
    const candidates = Array.from({ length: 100 }, (_, id) => ({ ...candidate(id), authorId: `a${id}` }));
    candidates.push({ ...candidate(100), authorId: "rare", projectType: "rare" });
    const selected = selectRecommendations(candidates, { ...options, limit: 1, random: () => 0.97 });
    expect(selected[0]!.projectId).toBe("p100");
  });

  it("preserves the capped reward for valid content updates", () => {
    const item = {
      ...candidate(0),
      contentChange: { changedEntries: 10, totalEntries: 10, reportedAt: "2026-11-02T00:00:00Z" },
    };
    expect(selectRecommendations([item], options)[0]!.contributions.contentChange).toBeCloseTo(0.03);
  });

  it("rejects contradictory snapshots and invalid sampling rather than biasing selection", () => {
    expect(() =>
      selectRecommendations([candidate(0), { ...candidate(0), projectVersionId: "other" }], options),
    ).toThrow("conflicting");
    expect(() => selectRecommendations([candidate(0)], { ...options, random: () => 1 })).toThrow("random");
    expect(() => selectRecommendations([candidate(0)], { ...options, temperature: Number.NaN })).toThrow("temperature");
  });
});
