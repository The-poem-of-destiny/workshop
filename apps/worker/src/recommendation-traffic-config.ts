/** Fixed estimate: legacy Worker requests, not visitors or actual recommendation impressions.
 * Source: Cloudflare workersOverviewRequestsAdaptiveGroups count, UTC hourly aggregation.
 * Account 873e2527b7bad1a15418e77bf5672277; script poemofdestinycreativeworkshop.
 * 2026-10-03T00:00:00Z <= time < 2026-11-03T00:00:00Z: 31 complete days,
 * 737/744 nonempty hourly groups; missing hours count as zero; 1957820 requests.
 * To revise: replace the source interval and all 24 hourly totals together, then redeploy.
 * No runtime Analytics credential or D1 configuration is required.
 */
export const RECOMMENDATION_TRAFFIC_CONFIG = {
  start: "2026-10-03T00:00:00Z",
  end: "2026-11-03T00:00:00Z",
  days: 31,
  hourlyTotals: [
    46770, 67780, 75280, 74330, 81960, 79980, 96200, 103870, 101000, 105240, 101800, 106420, 103660, 121700, 125480,
    129760, 121170, 93200, 69790, 44470, 32250, 26430, 20430, 28850,
  ],
} as const;
