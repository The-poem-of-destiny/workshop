import { describe, expect, it } from "vitest";
import { estimateOpportunities, type OpportunityBatch } from "./opportunity-accounting.js";

const hour = 3_600_000;
const midnight = Date.parse("2026-11-02T00:00:00Z");
const batch = (id: string, activatedAt: number, overrides: Partial<OpportunityBatch> = {}): OpportunityBatch => ({
  id,
  activatedAt,
  displayStart: midnight,
  displayEnd: midnight + 8 * hour,
  replacedAt: null,
  failedAt: null,
  eligibilityEnd: null,
  eligibilityKnown: true,
  hourlyProfile: Array.from({ length: 24 }, (_, index) => (index + 1) * 10),
  ...overrides,
});

describe("opportunity accounting", () => {
  it("integrates partial UTC hours within the requested display and eligibility bounds", () => {
    const result = estimateOpportunities(
      [batch("a", midnight, { displayStart: midnight + hour / 2, eligibilityEnd: midnight + 2.25 * hour })],
      { start: midnight, end: midnight + 4 * hour },
    );
    expect(result).toEqual([
      { batchId: "a", start: midnight + hour / 2, end: midnight + 2.25 * hour, estimatedOpportunity: 32.5 },
    ]);
  });

  it("permanently clips a predecessor at activation even when the replacement has not begun displaying or fails", () => {
    const result = estimateOpportunities(
      [
        batch("b", midnight + 2 * hour, { displayStart: midnight + 3 * hour, failedAt: midnight + 4 * hour }),
        batch("a", midnight, { replacedAt: midnight + 7 * hour }),
      ],
      { start: midnight + hour, end: midnight + 8 * hour },
    );
    expect(result).toEqual([
      { batchId: "a", start: midnight + hour, end: midnight + 2 * hour, estimatedOpportunity: 20 },
      { batchId: "b", start: midnight + 3 * hour, end: midnight + 4 * hour, estimatedOpportunity: 40 },
    ]);
  });

  it("clips explicit replacement and failure before crediting opportunity", () => {
    const result = estimateOpportunities(
      [batch("a", midnight, { replacedAt: midnight + 1.5 * hour, failedAt: midnight + 2 * hour })],
      { start: midnight, end: midnight + 4 * hour },
    );
    expect(result[0]).toEqual({ batchId: "a", start: midnight, end: midnight + 1.5 * hour, estimatedOpportunity: 20 });
  });

  it("does not fabricate counts when eligibility or a needed profile bucket is unknown", () => {
    const profile = Array.from({ length: 24 }, () => 10 as number | null);
    profile[1] = null;
    const window = { start: midnight, end: midnight + 2 * hour };
    for (const overrides of [{ eligibilityKnown: false }, { hourlyProfile: null }, { hourlyProfile: profile }]) {
      expect(estimateOpportunities([batch("a", midnight, overrides)], window)[0]?.estimatedOpportunity).toBeNull();
    }
    expect(
      estimateOpportunities([batch("a", midnight, { hourlyProfile: profile })], {
        start: midnight,
        end: midnight + hour,
      })[0]?.estimatedOpportunity,
    ).toBe(10);
  });

  it("does not emit empty intervals and gives later equal-time activations precedence", () => {
    expect(
      estimateOpportunities([batch("a", midnight, { eligibilityEnd: midnight })], {
        start: midnight,
        end: midnight + hour,
      }),
    ).toEqual([]);
    expect(
      estimateOpportunities([batch("a", midnight), batch("b", midnight)], { start: midnight, end: midnight + hour }),
    ).toEqual([{ batchId: "b", start: midnight, end: midnight + hour, estimatedOpportunity: 10 }]);
  });
});
