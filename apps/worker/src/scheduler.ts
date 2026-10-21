import type { Env } from "./env";

const MAX_ATTEMPTS = 3;

export async function runScheduled(env: Env): Promise<void> {
  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE submissions
    SET status = 'pending', check_status = 'needs_human', check_lease_until = NULL,
        check_error = COALESCE(check_error, '检查超时次数已达上限，转人工审核。')
    WHERE status = 'checking' AND check_status IN ('queued', 'running') AND check_attempts >= ?
  `).bind(MAX_ATTEMPTS).run();

  const due = await env.DB.prepare(`
    SELECT id FROM submissions
    WHERE status IN ('checking', 'pending')
      AND check_status IN ('queued', 'running')
      AND check_attempts < ?
      AND (check_lease_until IS NULL OR check_lease_until < ?)
    ORDER BY submitted_at ASC
    LIMIT 20
  `).bind(MAX_ATTEMPTS, now).all<{ id: string }>();

  if (due.results.length === 0) return;
  const stub = env.CONTENT_SERVICE.get(env.CONTENT_SERVICE.idFromName("content-service"));
  for (const row of due.results) {
    await stub.fetch("https://content-service/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: row.id }),
    });
  }
}

export function enqueueSubmission(env: Env, submissionId: string): Promise<Response> {
  const stub = env.CONTENT_SERVICE.get(env.CONTENT_SERVICE.idFromName("content-service"));
  return stub.fetch("https://content-service/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ submissionId }),
  });
}
