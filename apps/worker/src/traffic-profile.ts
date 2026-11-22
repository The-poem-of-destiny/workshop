import { deriveOpportunityWindows, type OpportunityWindow, type TrafficProfile } from "@workshop/domain";
import { RECOMMENDATION_TRAFFIC_CONFIG } from "./recommendation-traffic-config.js";

export { deriveOpportunityWindows, type OpportunityWindow, type TrafficProfile };

/** Code-side configuration; historical activations keep their own immutable accounting snapshot. */
export const FIXED_TRAFFIC_PROFILE: TrafficProfile = {
  start: RECOMMENDATION_TRAFFIC_CONFIG.start,
  end: RECOMMENDATION_TRAFFIC_CONFIG.end,
  hourlyMean: RECOMMENDATION_TRAFFIC_CONFIG.hourlyTotals.map((count) => count / RECOMMENDATION_TRAFFIC_CONFIG.days),
};
