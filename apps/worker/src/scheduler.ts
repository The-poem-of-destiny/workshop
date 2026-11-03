import type { Env } from "./env";

export async function runScheduled(env: Env, exports: Cloudflare.Exports, scheduledTime?: number): Promise<void> {
  const scheduled = new Date(scheduledTime ?? Date.now());
  const timestamp = scheduled.getTime();
  const data = exports.DataService;
  if (scheduled.getUTCMinutes() === 5) {
    await data.buildScheduledRecommendationBatch(timestamp);
  }
  if (scheduled.getUTCHours() === 0 && scheduled.getUTCMinutes() === 5) {
    const result = await data.cleanupScheduledData(timestamp);
    console.log("cleanup observation; retention policy undecided", result);
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
