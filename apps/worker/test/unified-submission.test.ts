import { env, SELF } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { REVIEW_CHECKER_REVISION } from "../src/content-checker";
import { ContentService } from "../src/content-service";
import type { DataEnv } from "../src/data/env";
import { runScheduled } from "../src/scheduler";
import { reviewAdminSubmission } from "../src/storage/admin";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;
const now = "2026-10-21T00:00:00.000Z";
const worldbook = JSON.stringify({ entries: [{ uid: 1, name: "Frozen entry", content: "Original content" }] });
const png = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73,
  69, 78, 68, 174, 66, 96, 130,
]);
// A valid ancillary tEXt chunk changes the object hash without corrupting the
// PNG image stream or relying on an unverified external base64 fixture.
const successorPng = Uint8Array.from([
  ...png.subarray(0, png.length - 12),
  0,
  0,
  0,
  17,
  116,
  69,
  88,
  116,
  67,
  111,
  109,
  109,
  101,
  110,
  116,
  0,
  115,
  117,
  99,
  99,
  101,
  115,
  115,
  111,
  114,
  107,
  108,
  164,
  57,
  ...png.subarray(png.length - 12),
]);

interface Draft {
  id: string;
  revisionId: string;
  rowVersion: number;
}
interface Submitted {
  submissionId: string;
  rowVersion: number;
  status: string;
  checkStatus: string;
}
interface Detail {
  submission: {
    id: string;
    status: string;
    checkStatus: string;
    checkAttempts: number;
    checkReportHash: string | null;
  };
  revision: { id: string; title: string; manifestHash: string };
}

function author(path: string, init: RequestInit = {}, token = "author-token") {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return SELF.fetch("https://workshop.test/api/v1/projects" + (path === "/" ? "" : path), { ...init, headers });
}
function admin(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer reviewer-token");
  return SELF.fetch("https://workshop.test/api/v1/admin" + path, { ...init, headers });
}
function json(method: string, body: unknown, version?: number): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json", ...(version === undefined ? {} : { "if-match": String(version) }) },
    body: JSON.stringify(body),
  };
}
async function seedUser(id: string, role: string) {
  await bindings.DB.prepare("INSERT INTO users (id, username, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, id, role, now, now)
    .run();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${id}-token`));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await bindings.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(hash, id, "2099-01-01T00:00:00.000Z")
    .run();
}
async function create(): Promise<Draft> {
  const response = await author(
    "/",
    json("POST", { title: "Published original", description: "Original description" }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { project: { id: string }; workingRevisionId: string; rowVersion: number };
  return { id: body.project.id, revisionId: body.workingRevisionId, rowVersion: body.rowVersion };
}
async function upload(draft: Draft, kind: "worldbook" | "cover", body: string | Uint8Array) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const response = await author(`/${draft.id}/revisions/${draft.revisionId}/files/${kind}`, {
    method: "PUT",
    headers: {
      "if-match": String(draft.rowVersion),
      "content-length": String(bytes.byteLength),
      "content-type": kind === "cover" ? "image/png" : "application/json",
    },
    body: new Uint8Array(bytes).buffer,
  });
  expect(response.status).toBe(200);
  draft.rowVersion = ((await response.json()) as { rowVersion: number }).rowVersion;
}
async function submit(draft: Draft, gate?: "pass" | "warn" | "block"): Promise<Submitted> {
  const response = await author(
    `/${draft.id}/revisions/${draft.revisionId}/submit`,
    json("POST", gate ? { gate, checkerRevision: "client-w1" } : {}, draft.rowVersion),
  );
  expect(response.status).toBe(201);
  const result = (await response.json()) as Submitted;
  draft.rowVersion = result.rowVersion;
  return result;
}
async function submitQueued(draft: Draft): Promise<Submitted> {
  const submitted = await submit(draft, "block");
  await bindings.DB.prepare(`
    UPDATE submissions SET client_gate = 'pass', status = 'checking', check_status = 'queued'
    WHERE id = ?
  `)
    .bind(submitted.submissionId)
    .run();
  return submitted;
}
async function nextRevision(draft: Draft, title = "Successor metadata") {
  const response = await author(`/${draft.id}/revisions`, json("POST", { title }, draft.rowVersion));
  expect(response.status).toBe(201);
  const result = (await response.json()) as { revisionId: string; rowVersion: number };
  draft.revisionId = result.revisionId;
  draft.rowVersion = result.rowVersion;
}
async function refresh(draft: Draft) {
  const response = await author(`/${draft.id}/draft`);
  expect(response.status).toBe(200);
  draft.rowVersion = ((await response.json()) as { rowVersion: number }).rowVersion;
}
async function detail(id: string): Promise<Detail> {
  const response = await admin(`/submissions/${id}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<Detail>;
}
async function run(id: string) {
  const service = bindings.CONTENT_SERVICE.get(bindings.CONTENT_SERVICE.idFromName(`unified-${id}`));
  const response = await service.fetch("https://content-service/run", json("POST", { submissionId: id }));
  expect(response.status).toBe(200);
  return response.json();
}
async function publicProject(id: string) {
  const response = await SELF.fetch(new URL(`/api/v1/projects/${id}`, "https://workshop.test").toString(), undefined);
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    title: string;
    description: string;
    coverUrl: string;
    publishedRevisionId: string;
  }>;
}
async function published(): Promise<Draft> {
  const draft = await create();
  await upload(draft, "worldbook", worldbook);
  await upload(draft, "cover", png);
  const submission = await submit(draft, "pass");
  await run(submission.submissionId);
  await vi.waitFor(
    async () => {
      expect((await detail(submission.submissionId)).submission).toMatchObject({
        status: "approved",
        checkStatus: "done",
      });
    },
    { timeout: 5_000 },
  );
  await refresh(draft);
  const response = await author(`/${draft.id}/visibility`, json("PATCH", { visibility: "public" }, draft.rowVersion));
  expect(response.status).toBe(200);
  draft.rowVersion = ((await response.json()) as { rowVersion: number }).rowVersion;
  return draft;
}
async function history(id: string) {
  const response = await SELF.fetch(
    new URL(`/api/v1/me/projects/${id}/submissions`, "https://workshop.test").toString(),
    {
      headers: { authorization: "Bearer author-token" },
    },
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<{ items: Array<{ id: string; status: string; withdrawnAt: string | null }> }>;
}

// Pause after the real data service reads the checker input, then perform
// author writes before the check resumes.
async function runAcrossMutation(id: string, mutation: () => Promise<void>) {
  let intercepted = false;
  const data = new Proxy(workerExports.DataService, {
    get(target, property) {
      if (property === "contentLoadSubmission") {
        return async (revisionId: string) => {
          const result = await target.contentLoadSubmission(revisionId);
          intercepted = true;
          await mutation();
          return result;
        };
      }
      return Reflect.get(target, property);
    },
  });
  const state = { exports: { ...workerExports, DataService: data } } as DurableObjectState;
  const checker = new ContentService(state, bindings);
  const response = await checker.fetch(new Request("https://content-service/run", json("POST", { submissionId: id })));
  const result = (await response.json()) as { error?: string };
  // A lost publication precondition may be reported as a conflict by the
  // checker. Do not mistake a hook assertion failure for that expected race.
  if (response.status !== 200) {
    expect(response.status).toBe(500);
    expect(result.error).toBe("自动发布前置条件已变化");
  }
  expect(intercepted).toBe(true);
}

beforeAll(async () => {
  await applySchema(bindings.DB);
});
beforeEach(async () => {
  await bindings.DB.exec(`
    DELETE FROM project_gallery; DELETE FROM audit_events; DELETE FROM reviews;
    DELETE FROM project_likes; DELETE FROM project_subscriptions; DELETE FROM project_ratings;
    DELETE FROM submissions; DELETE FROM assets; DELETE FROM project_revisions;
    DELETE FROM projects; DELETE FROM sessions; DELETE FROM users;
  `);
  await seedUser("author", "member");
  await seedUser("other", "member");
  await seedUser("reviewer", "reviewer");
});

describe("unified frozen submissions", () => {
  it("keeps draft metadata and cover private, then publishes inherited content with the reviewed snapshot", async () => {
    const draft = await published();
    const original = await publicProject(draft.id);
    const originalCover = await SELF.fetch(new URL(original.coverUrl, "https://workshop.test").toString(), undefined);
    expect(originalCover.status).toBe(200);
    expect(new Uint8Array(await originalCover.arrayBuffer())).toEqual(png);
    await nextRevision(draft);
    const patched = await author(
      `/${draft.id}`,
      json(
        "PATCH",
        {
          title: "Reviewed successor",
          description: "New description",
          coverPositionX: 25,
          coverPositionY: 75,
        },
        draft.rowVersion,
      ),
    );
    expect(patched.status).toBe(200);
    draft.rowVersion = ((await patched.json()) as { rowVersion: number }).rowVersion;
    await upload(draft, "cover", successorPng);
    expect(await publicProject(draft.id)).toEqual(original);

    // No content upload: the new revision must remain a complete usable release.
    const submission = await submit(draft, "block");
    const frozen = await detail(submission.submissionId);
    expect(frozen.revision).toMatchObject({ id: draft.revisionId, title: "Reviewed successor" });
    const content = await admin(`/submissions/${submission.submissionId}/files/worldbook`);
    expect(content.status).toBe(200);
    expect(await content.text()).toBe(worldbook);
    expect((await author(`/${draft.id}`, json("PATCH", { title: "Late edit" }, draft.rowVersion))).status).toBe(409);
    expect(
      (
        await author(`/${draft.id}/revisions/${draft.revisionId}/files/cover`, {
          method: "PUT",
          headers: {
            "if-match": String(draft.rowVersion),
            "content-type": "image/png",
            "content-length": String(png.length),
          },
          body: png,
        })
      ).status,
    ).toBe(404);
    expect(await publicProject(draft.id)).toEqual(original);
    const approved = await admin(
      `/submissions/${submission.submissionId}/review`,
      json("POST", {
        decision: "approve",
        reason: "人工确认完整冻结内容",
        revisionId: frozen.revision.id,
        manifestHash: frozen.revision.manifestHash,
      }),
    );
    expect(approved.status).toBe(201);
    expect(await publicProject(draft.id)).toMatchObject({
      title: "Reviewed successor",
      description: "New description",
      publishedRevisionId: draft.revisionId,
    });
    const released = await publicProject(draft.id);
    expect(released.coverUrl).not.toBe(original.coverUrl);
    const releasedCover = await SELF.fetch(new URL(released.coverUrl, "https://workshop.test").toString(), undefined);
    expect(releasedCover.status).toBe(200);
    expect(new Uint8Array(await releasedCover.arrayBuffer())).toEqual(successorPng);
    const preview = await SELF.fetch(
      new URL(`/api/v1/projects/${draft.id}/preview/worldbook`, "https://workshop.test").toString(),
      {
        headers: { authorization: "Bearer author-token" },
      },
    );
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      revisionId: draft.revisionId,
      entries: [{ name: "Frozen entry", content: "Original content" }],
    });
  });

  it.each(["block", undefined] as const)(
    "accepts author gate %s for manual review without requiring a server recheck",
    async (gate) => {
      const draft = await create();
      await upload(draft, "worldbook", worldbook);
      const submitted = await submit(draft, gate);
      expect(submitted).toMatchObject({ status: "pending", checkStatus: "needs_human" });
      expect((await detail(submitted.submissionId)).submission).toMatchObject({ checkAttempts: 0 });
      const approved = await admin(
        `/submissions/${submitted.submissionId}/review`,
        json("POST", {
          decision: "approve",
          reason: "人工已核对原始冻结内容",
        }),
      );
      expect(approved.status).toBe(201);
      expect((await detail(submitted.submissionId)).submission).toMatchObject({ status: "approved", checkAttempts: 0 });
    },
  );

  it.each(["pass", "warn"] as const)(
    "queues author gate %s for real cloud checking and automatic publication",
    async (gate) => {
      const draft = await create();
      await upload(draft, "worldbook", worldbook);
      const submitted = await submit(draft, gate);
      expect(submitted).toMatchObject({ status: "checking", checkStatus: "queued" });
      await run(submitted.submissionId);
      await vi.waitFor(
        async () => {
          expect((await detail(submitted.submissionId)).submission).toMatchObject({
            status: "approved",
            checkStatus: "done",
            checkAttempts: 1,
          });
        },
        { timeout: 5_000 },
      );
      const response = await author(`/${draft.id}/draft`);
      await expect(response.json()).resolves.toMatchObject({ project: { publishedRevisionId: draft.revisionId } });
    },
  );

  it.each(["block", "pass"] as const)(
    "withdraws pending/checking gate %s with CAS and durable history",
    async (gate) => {
      const draft = await published();
      const original = await publicProject(draft.id);
      await nextRevision(draft);
      // Keep the checker unstarted until after withdrawal.
      const submitted = gate === "pass" ? await submitQueued(draft) : await submit(draft, "block");
      const path = `/${draft.id}/submissions/${submitted.submissionId}/withdraw`;
      expect((await author(path, { method: "POST" })).status).toBe(412);
      expect((await author(path, json("POST", {}, draft.rowVersion - 1))).status).toBe(412);
      expect((await author(path, json("POST", {}, draft.rowVersion), "other-token")).status).toBe(404);
      expect((await detail(submitted.submissionId)).submission).toMatchObject({
        status: gate === "pass" ? "checking" : "pending",
        checkStatus: gate === "pass" ? "queued" : "needs_human",
      });
      const response = await author(path, json("POST", {}, draft.rowVersion));
      expect(response.status).toBe(200);
      const withdrawn = await history(draft.id);
      expect(withdrawn.items).toContainEqual(
        expect.objectContaining({
          id: submitted.submissionId,
          status: "superseded",
          withdrawnAt: expect.any(String),
        }),
      );
      await run(submitted.submissionId);
      expect(await publicProject(draft.id)).toEqual(original);
      expect(
        (await admin(`/submissions/${submitted.submissionId}/review`, json("POST", { decision: "approve" }))).status,
      ).toBe(409);
    },
  );

  it.each(["withdraw", "replace"] as const)("does not publish a check completing after %s", async (action) => {
    const draft = await published();
    const original = await publicProject(draft.id);
    await nextRevision(draft, "Obsolete candidate");
    const submitted = await submitQueued(draft);
    let successor: Submitted | undefined;
    await runAcrossMutation(submitted.submissionId, async () => {
      expect((await detail(submitted.submissionId)).submission.checkStatus).toBe("running");
      if (action === "withdraw") {
        const response = await author(
          `/${draft.id}/submissions/${submitted.submissionId}/withdraw`,
          json("POST", {}, draft.rowVersion),
        );
        expect(response.status).toBe(200);
      } else {
        await nextRevision(draft, "Replacement candidate");
        successor = await submit(draft, "block");
      }
    });
    const obsolete = await detail(submitted.submissionId);
    expect(obsolete.submission).toMatchObject({ status: "superseded", checkStatus: "running", checkAttempts: 1 });
    await run(submitted.submissionId);
    expect((await detail(submitted.submissionId)).submission).toMatchObject({
      status: "superseded",
      checkStatus: "running",
      checkAttempts: 1,
    });
    expect(await publicProject(draft.id)).toEqual(original);
    if (successor)
      expect((await detail(successor.submissionId)).submission).toMatchObject({
        status: "pending",
        checkStatus: "needs_human",
      });
    const rows = (await history(draft.id)).items;
    expect(rows).toContainEqual(
      expect.objectContaining({
        id: submitted.submissionId,
        status: "superseded",
        withdrawnAt: action === "withdraw" ? expect.any(String) : null,
      }),
    );
  });

  it("keeps explicit reviewer rechecks manual and binds decisions to the exact frozen evidence", async () => {
    const draft = await published();
    const original = await publicProject(draft.id);
    await nextRevision(draft);
    const submitted = await submit(draft, "block");
    expect(
      await workerExports.DataService.authorAdminRecheck("Bearer reviewer-token", submitted.submissionId),
    ).toMatchObject({ kind: "ok" });
    expect(
      (
        await admin(
          `/submissions/${submitted.submissionId}/review`,
          json("POST", { decision: "approve", reason: "Too early" }),
        )
      ).status,
    ).toBe(409);
    await run(submitted.submissionId);
    const checked = await detail(submitted.submissionId);
    expect(checked.submission).toMatchObject({ status: "pending", checkStatus: "needs_human", checkAttempts: 1 });
    expect(checked.submission.checkReportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await publicProject(draft.id)).toEqual(original);
    const evidence = {
      decision: "approve",
      reason: "人工核对冻结快照及检查证据",
      revisionId: checked.revision.id,
      manifestHash: checked.revision.manifestHash,
      reportHash: checked.submission.checkReportHash,
    };
    for (const mismatch of [
      { revisionId: "different-revision" },
      { manifestHash: "different-manifest" },
      { reportHash: "different-report" },
    ]) {
      expect(
        (await admin(`/submissions/${submitted.submissionId}/review`, json("POST", { ...evidence, ...mismatch })))
          .status,
      ).toBe(409);
      expect((await detail(submitted.submissionId)).submission.status).toBe("pending");
      expect(await publicProject(draft.id)).toEqual(original);
    }
    expect((await admin(`/submissions/${submitted.submissionId}/review`, json("POST", evidence))).status).toBe(201);
    expect((await publicProject(draft.id)).publishedRevisionId).toBe(checked.revision.id);
  });
  it("upgrades an old checker only through an explicit reviewer recheck", async () => {
    const draft = await create();
    await upload(draft, "worldbook", worldbook);
    const submitted = await submit(draft, "block");
    await bindings.DB.prepare("UPDATE submissions SET review_checker_revision = ? WHERE id = ?")
      .bind("retired-checker-w1", submitted.submissionId)
      .run();
    // The HTTP route starts a background checker immediately. Invoke the same
    // authorized recheck operation directly here so this test can await the
    // real checker run and inspect its result without racing that background run.
    expect(
      await workerExports.DataService.authorAdminRecheck("Bearer reviewer-token", submitted.submissionId),
    ).toMatchObject({ kind: "ok" });
    await expect(run(submitted.submissionId)).resolves.toMatchObject({
      revision: REVIEW_CHECKER_REVISION,
      manual: true,
    });
    const checked = await detail(submitted.submissionId);
    expect(checked.submission).toMatchObject({
      status: "pending",
      checkStatus: "needs_human",
      checkAttempts: 1,
      reviewCheckerRevision: REVIEW_CHECKER_REVISION,
    });
    expect(checked.submission.checkReportHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("recovers an exhausted manual recheck only after its running lease expires", async () => {
    const draft = await create();
    await upload(draft, "worldbook", worldbook);
    const submitted = await submit(draft, "block");
    await bindings.DB.prepare(`UPDATE submissions SET status = 'pending', check_status = 'running',
      check_attempts = 3, check_lease_until = ? WHERE id = ?`)
      .bind("2030-01-01T12:01:00.000Z", submitted.submissionId)
      .run();
    await runScheduled(bindings, workerExports, Date.parse("2030-01-01T12:00:00.000Z"));
    expect((await detail(submitted.submissionId)).submission).toMatchObject({
      status: "pending",
      checkStatus: "running",
      checkAttempts: 3,
    });
    await runScheduled(bindings, workerExports, Date.parse("2030-01-01T12:01:00.000Z"));
    expect((await detail(submitted.submissionId)).submission.checkStatus).toBe("running");
    await runScheduled(bindings, workerExports, Date.parse("2030-01-01T12:02:00.000Z"));
    expect((await detail(submitted.submissionId)).submission).toMatchObject({
      status: "pending",
      checkStatus: "needs_human",
      checkAttempts: 3,
    });
    expect(
      await workerExports.DataService.authorAdminRecheck("Bearer reviewer-token", submitted.submissionId),
    ).toMatchObject({ kind: "ok" });
    await run(submitted.submissionId);
    expect((await detail(submitted.submissionId)).submission).toMatchObject({
      status: "pending",
      checkStatus: "needs_human",
      checkAttempts: 1,
    });
  });

  it.each([
    ["approve", "queued"],
    ["approve", "new-report"],
    ["reject", "queued"],
    ["reject", "new-report"],
  ] as const)("rejects a stale %s decision when %s wins before its transaction", async (decision, race) => {
    const draft = await published();
    const original = await publicProject(draft.id);
    await nextRevision(draft);
    const submitted = await submit(draft, "block");
    const frozen = await detail(submitted.submissionId);
    let intercepted = false;
    // Pause the storage transaction after it has read the target, so a real
    // recheck can change the evidence before the guarded D1 batch executes.
    const db = new Proxy(bindings.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            expect(intercepted).toBe(false);
            intercepted = true;
            expect(
              await workerExports.DataService.authorAdminRecheck("Bearer reviewer-token", submitted.submissionId),
            ).toMatchObject({ kind: "ok" });
            if (race === "new-report") {
              await run(submitted.submissionId);
              expect((await detail(submitted.submissionId)).submission.checkReportHash).toMatch(/^[0-9a-f]{64}$/);
            }
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await reviewAdminSubmission(db, submitted.submissionId, "reviewer", {
      decision,
      reason: "人工已阅读先前冻结证据",
      revisionId: frozen.revision.id,
      manifestHash: frozen.revision.manifestHash,
    });
    expect(intercepted).toBe(true);
    expect(result.kind).toBe("conflict");
    if (race === "queued") {
      const response = await admin(
        `/submissions/${submitted.submissionId}/review`,
        json("POST", {
          decision,
          reason: "人工已阅读先前冻结证据",
          revisionId: frozen.revision.id,
          manifestHash: frozen.revision.manifestHash,
        }),
      );
      expect(response.status).toBe(409);
    }
    expect((await detail(submitted.submissionId)).submission).toMatchObject({
      status: "pending",
      checkStatus: race === "queued" ? "queued" : "needs_human",
    });
    expect(await publicProject(draft.id)).toEqual(original);
    const reviews = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM reviews WHERE submission_id = ?")
      .bind(submitted.submissionId)
      .first<{ count: number }>();
    expect(reviews?.count).toBe(0);
  });

  it.each(["approve", "reject"] as const)(
    "allows only one concurrent %s review through the HTTP API",
    async (decision) => {
      const draft = await published();
      const original = await publicProject(draft.id);
      await nextRevision(draft);
      const submitted = await submit(draft, "block");
      const frozen = await detail(submitted.submissionId);
      const evidence = {
        decision,
        reason: "人工已阅读冻结证据",
        revisionId: frozen.revision.id,
        manifestHash: frozen.revision.manifestHash,
      };
      const responses = await Promise.all([
        admin(`/submissions/${submitted.submissionId}/review`, json("POST", evidence)),
        admin(`/submissions/${submitted.submissionId}/review`, json("POST", evidence)),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect((await detail(submitted.submissionId)).submission.status).toBe(
        decision === "approve" ? "approved" : "rejected",
      );
      const project = await publicProject(draft.id);
      if (decision === "approve") {
        expect(project.publishedRevisionId).toBe(frozen.revision.id);
      } else {
        expect(project).toEqual(original);
      }
      const reviews = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM reviews WHERE submission_id = ?")
        .bind(submitted.submissionId)
        .first<{ count: number }>();
      expect(reviews?.count).toBe(1);
      const audits = await bindings.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_events WHERE target_id = ? AND action = ?",
      )
        .bind(submitted.submissionId, `review.${decision}`)
        .first<{ count: number }>();
      expect(audits?.count).toBe(1);
    },
  );
});
