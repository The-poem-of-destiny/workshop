import { describe, expect, it } from "vitest";
import { deriveOpportunityWindows } from "../src/traffic-profile";

describe("Worker traffic profile", () => {
  it("partitions uniform traffic evenly and bounds windows for concentrated traffic", () => {
    const uniform = { start: "", end: "", hourlyMean: Array<number>(24).fill(10) };
    expect(deriveOpportunityWindows(uniform)).toEqual([
      { startHour: 0, endHour: 4, estimatedRequests: 40 },
      { startHour: 4, endHour: 8, estimatedRequests: 40 },
      { startHour: 8, endHour: 12, estimatedRequests: 40 },
      { startHour: 12, endHour: 16, estimatedRequests: 40 },
      { startHour: 16, endHour: 20, estimatedRequests: 40 },
      { startHour: 20, endHour: 24, estimatedRequests: 40 },
    ]);
    const concentrated = deriveOpportunityWindows({ ...uniform, hourlyMean: [100, ...Array<number>(23).fill(0)] });
    expect(concentrated[0]!.startHour).toBe(0);
    expect(concentrated[5]!.endHour).toBe(24);
    expect(concentrated.reduce((sum, window) => sum + window.estimatedRequests, 0)).toBe(100);
    for (const [index, window] of concentrated.entries()) {
      expect(window.endHour - window.startHour).toBeGreaterThanOrEqual(1);
      expect(window.endHour - window.startHour).toBeLessThanOrEqual(8);
      if (index > 0) expect(window.startHour).toBe(concentrated[index - 1]!.endHour);
    }
    expect(() => deriveOpportunityWindows({ ...uniform, hourlyMean: Array<number>(24).fill(0) })).toThrow();
  });
});
