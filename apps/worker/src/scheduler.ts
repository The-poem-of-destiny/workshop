import type { Env } from "./env";

export async function runScheduled(env: Env, exports: Cloudflare.Exports, scheduledTime?: number): Promise<void> {
  const scheduled = new Date(scheduledTime ?? Date.now());
  const timestamp = scheduled.getTime();
  const data = exports.DataService;
  if (scheduled.getUTCMinutes() === 5) {
    await data.buildScheduledRankings(timestamp);
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
  return stub.fetch("https://content-service/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ submissionId }),
  });
}
