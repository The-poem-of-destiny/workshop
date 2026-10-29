import type { Env } from "./env";
import { PROJECT_PROJECTIONS, purgePublicPaths } from "./http/public-invalidation";

export async function runScheduled(env: Env, exports: Cloudflare.Exports, scheduledTime?: number): Promise<void> {
  const scheduled = new Date(scheduledTime ?? Date.now());
  const timestamp = scheduled.getTime();
  const data = exports.DataService;
  if (scheduled.getUTCMinutes() === 5) {
    await data.buildScheduledRankings(timestamp);
    await purgePublicPaths(["/api/v1/projects/rankings", "/api/v1/projects/discovery", "/api/v1/home"]);
  }
  if (scheduled.getUTCHours() === 0 && scheduled.getUTCMinutes() === 5) {
    const dryRun = env.CLEANUP_DRY_RUN === "1";
    const result = await data.cleanupScheduledData(dryRun, timestamp);
    if (dryRun) console.log("cleanup dry-run", result);
  }

  const due = await data.findDueSubmissions(timestamp);
  for (const submissionId of due) {
    await enqueueSubmission(env, submissionId);
  }
}

export async function enqueueSubmission(env: Env, submissionId: string): Promise<Response> {
  const stub = env.CONTENT_SERVICE.get(env.CONTENT_SERVICE.idFromName("content-service"));
  const response = await stub.fetch("https://content-service/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ submissionId }),
  });
  if (response.ok) {
    const result = await response.clone().json<{ published?: boolean }>();
    if (result.published) await purgePublicPaths(PROJECT_PROJECTIONS);
  }
  return response;
}
