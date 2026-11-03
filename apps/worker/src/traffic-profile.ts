import { RECOMMENDATION_TRAFFIC_CONFIG } from "./recommendation-traffic-config.js";

export interface TrafficProfile {
  start: string;
  end: string;
  /** Estimated mean Worker requests for each UTC hour over the recorded source interval. */
  hourlyMean: number[];
}

export interface OpportunityWindow {
  startHour: number;
  endHour: number;
  estimatedRequests: number;
}

/** Code-side configuration; historical activations keep their own immutable accounting snapshot. */
export const FIXED_TRAFFIC_PROFILE: TrafficProfile = {
  start: RECOMMENDATION_TRAFFIC_CONFIG.start,
  end: RECOMMENDATION_TRAFFIC_CONFIG.end,
  hourlyMean: RECOMMENDATION_TRAFFIC_CONFIG.hourlyTotals.map((count) => count / RECOMMENDATION_TRAFFIC_CONFIG.days),
};

/** Six hourly-aligned windows, each 1–8 hours, minimize unequal request opportunity.
 * The cap prevents a long quiet period from keeping a batch displayed all day.
 */
export function deriveOpportunityWindows(profile: TrafficProfile): OpportunityWindow[] {
  const hours = profile.hourlyMean;
  if (hours.length !== 24 || hours.some((count) => !Number.isFinite(count) || count < 0)) {
    throw new Error("Invalid hourly traffic profile");
  }
  const total = hours.reduce((sum, count) => sum + count, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("Traffic profile contains no requests");
  const prefix = [0];
  for (const count of hours) prefix.push(prefix[prefix.length - 1]! + count);
  const costs = Array.from({ length: 7 }, () => Array<number>(25).fill(Infinity));
  const previous = Array.from({ length: 7 }, () => Array<number>(25).fill(-1));
  costs[0]![0] = 0;
  for (let window = 1; window <= 6; window++) {
    for (let end = 1; end <= 24; end++) {
      for (let start = Math.max(0, end - 8); start < end; start++) {
        const difference = (prefix[end]! - prefix[start]!) / total - 1 / 6;
        const cost = costs[window - 1]![start]! + difference * difference;
        if (cost < costs[window]![end]!) {
          costs[window]![end] = cost;
          previous[window]![end] = start;
        }
      }
    }
  }
  const windows: OpportunityWindow[] = [];
  let end = 24;
  for (let window = 6; window > 0; window--) {
    const start = previous[window]![end]!;
    windows.push({ startHour: start, endHour: end, estimatedRequests: prefix[end]! - prefix[start]! });
    end = start;
  }
  return windows.reverse();
}
