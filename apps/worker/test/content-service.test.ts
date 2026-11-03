import { env } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REVIEW_CHECKER_VERSION } from "../src/content-checker";
import type { DataEnv } from "../src/data/env";
import { runScheduled } from "../src/scheduler";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const now = "2026-10-21T00:00:00.000Z";

function service() {
  return bindings.CONTENT_SERVICE.get(bindings.CONTENT_SERVICE.idFromName("test-content"));
}

async function run(submissionId: string) {
  return service().fetch("https://content-service/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ submissionId }),
  });
}

async function seedProject(id: string, content: string) {
  await bindings.DB.prepare(
    "INSERT INTO users (id, username, role, created_at, updated_at) VALUES (?, ?, 'member', ?, ?)",
  )
    .bind(`u-${id}`, `u-${id}`, now, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO projects (id, author_id, visibility, working_version_id, created_at, updated_at)
    VALUES (?, ?, 'private', ?, ?, ?)
  `)
    .bind(id, `u-${id}`, `r-${id}`, now, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO project_versions
      (id, project_id, version_no, title, created_by, created_at)
    VALUES (?, ?, 1, ?, ?, ?)
  `)
    .bind(`r-${id}`, id, id, `u-${id}`, now)
    .run();
  const key = `projects/${id}/versions/r-${id}/worldbook.json`;
  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES (?, ?, ?, 'worldbook', ?, ?, ?, 'application/json', ?)
  `)
    .bind(`a-${id}`, id, `r-${id}`, key, "hash", content.length, now)
    .run();
  await bindings.R2.put(key, content);
}

async function seedSubmission(id: string, projectId: string, gate = "warn", checkStatus = "queued", attempts = 0) {
  await bindings.DB.prepare(`
    INSERT INTO submissions
      (id, project_id, version_id, status, submitted_by, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(id, projectId, `r-${projectId}`, checkStatus === "queued" ? "checking" : "pending", `u-${projectId}`, now)
    .run();
  await bindings.DB.prepare(`INSERT INTO automated_reviews
    (submission_id,client_gate,client_checker_version,status,attempts) VALUES (?,?,'client-1',?,?)`)
    .bind(id, gate, checkStatus, attempts)
    .run();
}

beforeAll(async () => {
  await applySchema(bindings.DB);
});

beforeEach(async () => {
  await bindings.DB.exec(`
    DELETE FROM audit_events;
    DELETE FROM manual_reviews;
    DELETE FROM automated_reviews;
    DELETE FROM submissions;
    DELETE FROM assets;
    DELETE FROM project_versions;
    DELETE FROM projects;
    DELETE FROM users;
  `);
});

describe("ContentService", () => {
  it("fences a superseded attempt from overwriting evidence or publishing", async () => {
    await seedProject("fenced", JSON.stringify({ entries: [] }));
    await seedSubmission("fenced-submission", "fenced");
    const data = workerExports.DataService;
    const first = await data.contentClaim("fenced-submission");
    expect(first).toBeTypeOf("string");
    await bindings.DB.prepare(
      "UPDATE automated_reviews SET lease_until='2000-01-01T00:00:00Z' WHERE submission_id='fenced-submission'",
    ).run();
    const second = await data.contentClaim("fenced-submission");
    expect(second).toBeTypeOf("string");
    expect(second).not.toBe(first);
    const target = await data.contentGetTarget("fenced-submission");
    if (!first || !second || !target) throw new Error("Expected two acquired review attempts");
    expect(await data.contentRecordRun("fenced-submission", second, "pass", "{}", "a".repeat(64), 1, now)).toBe(true);
    expect(await data.contentRecordRun("fenced-submission", first, "block", "{}", "b".repeat(64), 2, now)).toBe(false);
    await data.contentRequeue("fenced-submission", "old failure", first);
    await data.contentNeedsHuman("fenced-submission", "old escalation", first);
    expect(await data.contentAutoPublish(target, first)).toBe(false);
    expect(
      await bindings.DB.prepare(
        "SELECT status,route_gate,report_hash FROM automated_reviews WHERE submission_id='fenced-submission'",
      ).first(),
    ).toEqual({ status: "running", route_gate: "pass", report_hash: "a".repeat(64) });
    expect(await bindings.DB.prepare("SELECT status FROM submissions WHERE id='fenced-submission'").first()).toEqual({
      status: "checking",
    });
    expect(await data.contentAutoPublish(target, second)).toBe(true);
    expect(await bindings.DB.prepare("SELECT published_version_id FROM projects WHERE id='fenced'").first()).toEqual({
      published_version_id: "r-fenced",
    });
  });
  it("runs the review checker and auto-publishes pass/warn", async () => {
    const content = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "plain" }] });
    await seedProject("p1", content);
    await seedSubmission("s1", "p1");
    const response = await run("s1");
    expect(response.status).toBe(200);
    const result = (await response.json()) as { routeGate: string; revision: string };
    expect(result).toMatchObject({ routeGate: "pass", revision: REVIEW_CHECKER_VERSION });

    const submission = await bindings.DB.prepare(
      "SELECT s.status, ar.status AS check_status, ar.checker_version AS checker_version, s.auto_published_at FROM submissions s JOIN automated_reviews ar ON ar.submission_id = s.id WHERE s.id = 's1'",
    ).first<Record<string, unknown>>();
    expect(submission).toMatchObject({
      status: "approved",
      check_status: "done",
      checker_version: REVIEW_CHECKER_VERSION,
    });
    expect(submission?.auto_published_at).toBeTruthy();
    const runs = await bindings.DB.prepare(
      "SELECT checker_version AS checker_version, route_gate FROM automated_reviews WHERE submission_id = 's1'",
    ).all<{ checker_version: string; route_gate: string }>();
    expect(runs.results).toEqual([
      {
        checker_version: REVIEW_CHECKER_VERSION,
        route_gate: "pass",
      },
    ]);
    const project = await bindings.DB.prepare(
      "SELECT published_version_id, published_updated_at FROM projects WHERE id = 'p1'",
    ).first<{ published_version_id: string | null; published_updated_at: string | null }>();
    expect(project?.published_version_id).toBe("r-p1");
    expect(project?.published_updated_at).toBe(submission?.auto_published_at);
  });

  it("routes checker block to human review without publishing", async () => {
    const content = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "<% function exposed(){} %>" }] });
    await seedProject("p2", content);
    await seedSubmission("s2", "p2");
    const response = await run("s2");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ routeGate: "block" });

    const submission = await bindings.DB.prepare(
      "SELECT s.status, ar.status AS check_status, ar.report_r2_key FROM submissions s JOIN automated_reviews ar ON ar.submission_id = s.id WHERE s.id = 's2'",
    ).first<{ status: string; check_status: string; report_r2_key: string }>();
    expect(submission).toMatchObject({ status: "pending", check_status: "needs_human" });
    const reportObject = await bindings.R2.get(submission!.report_r2_key);
    expect(JSON.parse(await reportObject!.text()).routeGate).toBe("block");
    const project = await bindings.DB.prepare("SELECT published_version_id FROM projects WHERE id = 'p2'").first<{
      published_version_id: string | null;
    }>();
    expect(project?.published_version_id).toBeNull();
  });

  it("keeps a requeued client-blocked submission manual after a server pass", async () => {
    const content = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "plain" }] });
    await seedProject("p4", content);
    await seedSubmission("s4", "p4", "block", "queued");
    const response = await run("s4");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ routeGate: "pass", manual: true });
    const submission = await bindings.DB.prepare(
      "SELECT s.status, ar.status AS check_status FROM submissions s JOIN automated_reviews ar ON ar.submission_id = s.id WHERE s.id = 's4'",
    ).first<Record<string, unknown>>();
    expect(submission).toMatchObject({ status: "pending", check_status: "needs_human" });
    const project = await bindings.DB.prepare("SELECT published_version_id FROM projects WHERE id = 'p4'").first<{
      published_version_id: string | null;
    }>();
    expect(project?.published_version_id).toBeNull();
  });

  it("does not run for missing client gates", async () => {
    const content = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "plain" }] });
    await seedProject("p3", content);
    await seedSubmission("s3", "p3", "missing", "needs_human");
    const response = await run("s3");
    await expect(response.json()).resolves.toMatchObject({ skipped: "needs_human" });
    const submission = await bindings.DB.prepare(
      "SELECT s.status, ar.status AS check_status, ar.attempts AS check_attempts FROM submissions s JOIN automated_reviews ar ON ar.submission_id = s.id WHERE s.id = 's3'",
    ).first<Record<string, unknown>>();
    expect(submission).toMatchObject({ status: "pending", check_status: "needs_human", check_attempts: 0 });
  });

  it("dispatches queued submissions from the scheduler", async () => {
    const content = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "plain" }] });
    await seedProject("p5", content);
    await seedSubmission("s5", "p5");
    await runScheduled(bindings, workerExports);
    const submission = await bindings.DB.prepare(
      "SELECT s.status, ar.status AS check_status FROM submissions s JOIN automated_reviews ar ON ar.submission_id = s.id WHERE s.id = 's5'",
    ).first<Record<string, unknown>>();
    expect(submission).toMatchObject({ status: "approved", check_status: "done" });
  });

  it("moves exhausted leases to human review", async () => {
    const content = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "plain" }] });
    await seedProject("p4", content);
    await seedSubmission("s4", "p4", "warn", "queued", 3);
    await runScheduled(bindings, workerExports);
    const submission = await bindings.DB.prepare(
      "SELECT s.status, ar.status AS check_status, ar.error AS check_error FROM submissions s JOIN automated_reviews ar ON ar.submission_id = s.id WHERE s.id = 's4'",
    ).first<Record<string, unknown>>();
    expect(submission).toMatchObject({ status: "pending", check_status: "needs_human" });
    expect(submission?.check_error).toContain("上限");
  });
});
