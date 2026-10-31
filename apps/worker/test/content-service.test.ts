import { env } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REVIEW_CHECKER_REVISION } from "../src/content-checker";
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
    INSERT INTO projects (id, author_id, title, visibility, working_revision_id, created_at, updated_at)
    VALUES (?, ?, ?, 'private', ?, ?, ?)
  `)
    .bind(id, `u-${id}`, id, `r-${id}`, now, now)
    .run();
  await bindings.DB.prepare(`
    INSERT INTO project_revisions
      (id, project_id, revision_no, title, created_by, created_at)
    VALUES (?, ?, 1, ?, ?, ?)
  `)
    .bind(`r-${id}`, id, id, `u-${id}`, now)
    .run();
  const key = `projects/${id}/revisions/r-${id}/worldbook.json`;
  await bindings.DB.prepare(`
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES (?, ?, ?, 'worldbook', ?, ?, ?, 'application/json', ?)
  `)
    .bind(`a-${id}`, id, `r-${id}`, key, "hash", content.length, now)
    .run();
  await bindings.R2.put(key, content);
}

async function seedSubmission(id: string, projectId: string, gate = "warn", checkStatus = "queued", attempts = 0) {
  await bindings.DB.prepare(`
    INSERT INTO submissions
      (id, project_id, revision_id, status, submitted_by, submitted_at,
       client_gate, client_checker_revision, client_warning_count, check_status, check_attempts)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'client-1', 1, ?, ?)
  `)
    .bind(
      id,
      projectId,
      `r-${projectId}`,
      checkStatus === "queued" ? "checking" : "pending",
      `u-${projectId}`,
      now,
      gate,
      checkStatus,
      attempts,
    )
    .run();
}

beforeAll(async () => {
  await applySchema(bindings.DB);
});

beforeEach(async () => {
  await bindings.DB.exec(`
    DELETE FROM audit_events;
    DELETE FROM reviews;
    DELETE FROM submissions;
    DELETE FROM assets;
    DELETE FROM project_revisions;
    DELETE FROM projects;
    DELETE FROM users;
  `);
});

describe("ContentService", () => {
  it("runs the review checker and auto-publishes pass/warn", async () => {
    const content = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "plain" }] });
    await seedProject("p1", content);
    await seedSubmission("s1", "p1");
    const response = await run("s1");
    expect(response.status).toBe(200);
    const result = (await response.json()) as { routeGate: string; revision: string };
    expect(result).toMatchObject({ routeGate: "pass", revision: REVIEW_CHECKER_REVISION });

    const submission = await bindings.DB.prepare(
      "SELECT status, check_status, review_checker_revision, auto_published_at FROM submissions WHERE id = 's1'",
    ).first<Record<string, unknown>>();
    expect(submission).toMatchObject({
      status: "approved",
      check_status: "done",
      review_checker_revision: REVIEW_CHECKER_REVISION,
    });
    expect(submission?.auto_published_at).toBeTruthy();
    const runs = await bindings.DB.prepare(
      "SELECT review_checker_revision, route_gate FROM submission_check_runs WHERE submission_id = 's1'",
    ).all<{ review_checker_revision: string; route_gate: string }>();
    expect(runs.results).toEqual([
      {
        review_checker_revision: REVIEW_CHECKER_REVISION,
        route_gate: "pass",
      },
    ]);
    const project = await bindings.DB.prepare(
      "SELECT published_revision_id, published_updated_at FROM projects WHERE id = 'p1'",
    ).first<{ published_revision_id: string | null; published_updated_at: string | null }>();
    expect(project?.published_revision_id).toBe("r-p1");
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
      "SELECT status, check_status, check_report FROM submissions WHERE id = 's2'",
    ).first<{ status: string; check_status: string; check_report: string }>();
    expect(submission).toMatchObject({ status: "pending", check_status: "needs_human" });
    expect(JSON.parse(submission!.check_report).routeGate).toBe("block");
    const project = await bindings.DB.prepare("SELECT published_revision_id FROM projects WHERE id = 'p2'").first<{
      published_revision_id: string | null;
    }>();
    expect(project?.published_revision_id).toBeNull();
  });

  it("keeps a requeued client-blocked submission manual after a server pass", async () => {
    const content = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "plain" }] });
    await seedProject("p4", content);
    await seedSubmission("s4", "p4", "block", "queued");
    const response = await run("s4");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ routeGate: "pass", manual: true });
    const submission = await bindings.DB.prepare("SELECT status, check_status FROM submissions WHERE id = 's4'").first<
      Record<string, unknown>
    >();
    expect(submission).toMatchObject({ status: "pending", check_status: "needs_human" });
    const project = await bindings.DB.prepare("SELECT published_revision_id FROM projects WHERE id = 'p4'").first<{
      published_revision_id: string | null;
    }>();
    expect(project?.published_revision_id).toBeNull();
  });

  it("does not run for missing client gates", async () => {
    const content = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "plain" }] });
    await seedProject("p3", content);
    await seedSubmission("s3", "p3", "missing", "needs_human");
    const response = await run("s3");
    await expect(response.json()).resolves.toMatchObject({ skipped: "needs_human" });
    const submission = await bindings.DB.prepare(
      "SELECT status, check_status, check_attempts FROM submissions WHERE id = 's3'",
    ).first<Record<string, unknown>>();
    expect(submission).toMatchObject({ status: "pending", check_status: "needs_human", check_attempts: 0 });
  });

  it("dispatches queued submissions from the scheduler", async () => {
    const content = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "plain" }] });
    await seedProject("p5", content);
    await seedSubmission("s5", "p5");
    await runScheduled(bindings, workerExports);
    const submission = await bindings.DB.prepare("SELECT status, check_status FROM submissions WHERE id = 's5'").first<
      Record<string, unknown>
    >();
    expect(submission).toMatchObject({ status: "approved", check_status: "done" });
  });

  it("moves exhausted leases to human review", async () => {
    const content = JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: "plain" }] });
    await seedProject("p4", content);
    await seedSubmission("s4", "p4", "warn", "queued", 3);
    await runScheduled(bindings, workerExports);
    const submission = await bindings.DB.prepare(
      "SELECT status, check_status, check_error FROM submissions WHERE id = 's4'",
    ).first<Record<string, unknown>>();
    expect(submission).toMatchObject({ status: "pending", check_status: "needs_human" });
    expect(submission?.check_error).toContain("上限");
  });
});
