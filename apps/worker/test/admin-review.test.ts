import { env, SELF } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DataEnv } from "../src/data/env";

import { applySchema } from "./support/schema";
import { splitSql } from "./support/sql";

const bindings = env as unknown as DataEnv;
const now = "2026-10-21T00:00:00.000Z";

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedSession(token: string, userId: string) {
  await bindings.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at, last_seen_at)
    VALUES (?, ?, 1, '2099-01-01T00:00:00.000Z', ?, ?)
  `)
    .bind(await tokenHash(token), userId, now, now)
    .run();
}

async function seed() {
  const statements = splitSql(`
    INSERT INTO users (id, username, global_name, role, created_at, updated_at) VALUES
      ('owner', 'owner', 'Owner', 'owner', '${now}', '${now}'),
      ('reviewer', 'reviewer', 'Reviewer', 'reviewer', '${now}', '${now}'),
      ('member', 'member', 'Member', 'member', '${now}', '${now}');
    INSERT INTO projects
      (id, author_id, title, description, author_note, project_type, extension_type,
       search_tags, visibility, working_revision_id, updated_at)
    VALUES ('p1', 'member', 'Draft title', 'Draft description', 'Draft note', '角色', '内容',
      '["draft"]', 'private', 'r1', '${now}');
    INSERT INTO project_revisions
      (id, project_id, revision_no, title, description, author_note, project_type, extension_type,
       tags, manifest_hash, created_by, created_at)
    VALUES ('r1', 'p1', 1, 'Submitted title', 'Submitted description', 'Submitted note', '事件', '规则',
      '["submitted"]', 'manifest-1', 'member', '${now}');
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('a1', 'p1', 'r1', 'worldbook', 'projects/p1/r1/worldbook.json', 'hash', 12,
      'application/json', '${now}');
    INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
    VALUES ('a2', 'p1', 'r1', 'cover', 'covers/p1/r1-cover.webp', 'hash2', 3,
      'image/webp', '${now}');
    INSERT INTO submissions
      (id, project_id, revision_id, status, client_gate, client_checker_revision, review_checker_revision, submitted_by, submitted_at)
    VALUES ('s1', 'p1', 'r1', 'pending', 'warn', 'client-1', 'checker-1', 'member', '${now}');
  `);
  for (const statement of statements) await bindings.DB.prepare(statement).run();
  await bindings.R2.put("covers/p1/r1-cover.webp", new Uint8Array([1, 2, 3]));
  await bindings.R2.put(
    "projects/p1/r1/worldbook.json",
    JSON.stringify({ entries: { 0: { uid: 1, comment: "Entry", content: "hello" } } }),
  );
  await seedSession("owner-token", "owner");
  await seedSession("reviewer-token", "reviewer");
  await seedSession("member-token", "member");
}

function request(path: string, token = "reviewer-token", init?: RequestInit) {
  return SELF.fetch("https://workshop.test/api/v1/admin" + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
}

beforeAll(async () => {
  await applySchema(bindings.DB);
});

beforeEach(async () => {
  await bindings.DB.exec(
    "DELETE FROM audit_events; DELETE FROM reviews; DELETE FROM submissions; DELETE FROM assets; DELETE FROM projects; DELETE FROM sessions; DELETE FROM users;",
  );
  await seed();
});

describe("admin review and publishing", () => {
  it("requires reviewer access and lists the queue", async () => {
    await expect((await request("/submissions", "member-token")).status).toBe(403);
    const response = await request("/submissions?status=pending");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: "s1", projectTitle: "Draft title", gate: "warn", checkerRevision: "client-1" }],
    });
  });

  it("restricts rechecks to reviewers and queues an unresolved submission", async () => {
    expect((await request("/submissions/s1/recheck", "member-token", { method: "POST" })).status).toBe(403);
    expect((await request("/submissions/missing/recheck", "reviewer-token", { method: "POST" })).status).toBe(404);
    const response = await request("/submissions/s1/recheck", "reviewer-token", { method: "POST" });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true, status: "queued" });
  });

  it("allows only one concurrent reviewer recheck and records one audit", async () => {
    const results = await Promise.all([
      workerExports.DataService.authorAdminRecheck("Bearer reviewer-token", "s1"),
      workerExports.DataService.authorAdminRecheck("Bearer owner-token", "s1"),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(["ok", "running"]);

    const submission = await bindings.DB.prepare(
      "SELECT status, check_status, review_checker_revision FROM submissions WHERE id = 's1'",
    ).first<Record<string, unknown>>();
    expect(submission).toEqual({ status: "pending", check_status: "queued", review_checker_revision: null });
    const audits = await bindings.DB.prepare(
      "SELECT actor_id, detail FROM audit_events WHERE target_id = 's1' AND action = 'checker.recheck'",
    ).all<{ actor_id: string; detail: string }>();
    expect(audits.results).toHaveLength(1);
    expect(audits.results[0]?.actor_id).toBe(results[0]?.kind === "ok" ? "reviewer" : "owner");
    expect(JSON.parse(audits.results[0]!.detail)).toEqual({
      reason: "explicit reviewer recheck",
      previousRevision: "checker-1",
    });
  });

  it("lists multiple statuses in one request and paginates with a keyset cursor", async () => {
    await bindings.DB.prepare(`
      INSERT INTO projects (id, author_id, title, visibility, working_revision_id, updated_at)
      VALUES ('p2', 'member', 'Second project', 'private', 'r2', '2026-10-21T00:00:01.000Z');
      INSERT INTO project_revisions (id, project_id, revision_no, title, created_by)
      VALUES ('r2', 'p2', 1, 'Second project', 'member');
      INSERT INTO submissions
        (id, project_id, revision_id, status, client_gate, client_checker_revision, submitted_by, submitted_at)
      VALUES ('s2', 'p2', 'r2', 'checking', 'warn', 'checker-1', 'member', '2026-10-21T00:00:01.000Z');
    `).run();

    const defaultPage = await request("/submissions");
    expect(defaultPage.status).toBe(200);
    await expect(defaultPage.json()).resolves.toMatchObject({ items: [{ id: "s1" }] });

    const first = await request("/submissions?status=pending,checking&limit=1");
    expect(first.status).toBe(200);
    const firstPage = (await first.json()) as {
      counts: Record<string, number>;
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(firstPage.items.map((item) => item.id)).toEqual(["s1"]);
    expect(firstPage.counts).toMatchObject({ pending: 1, checking: 1 });
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const second = await request(
      `/submissions?status=pending,checking&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ items: [{ id: "s2" }], nextCursor: null });
  });

  it("returns detail metadata without file contents", async () => {
    const response = await request("/submissions/s1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      revision: Record<string, unknown>;
      assets: Array<Record<string, unknown>>;
    };
    expect(body.revision).toMatchObject({ id: "r1", manifestHash: "manifest-1" });
    expect(body.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "worldbook", r2Key: "projects/p1/r1/worldbook.json" }),
        expect.objectContaining({ kind: "cover", r2Key: "covers/p1/r1-cover.webp" }),
      ]),
    );
    expect(body.assets[0]).not.toHaveProperty("content");
  });

  it("serves the submission cover to reviewers but not members", async () => {
    expect((await request("/submissions/s1/files/cover", "member-token")).status).toBe(403);
    const response = await request("/submissions/s1/files/cover");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("approves atomically and switches the published pointer", async () => {
    const response = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(201);
    const project = await bindings.DB.prepare(
      "SELECT published_revision_id, published_updated_at, title, search_tags, row_version FROM projects WHERE id = 'p1'",
    ).first<Record<string, unknown>>();
    expect(project).toMatchObject({
      published_revision_id: "r1",
      title: "Submitted title",
      search_tags: '["submitted"]',
      row_version: 2,
    });
    const submission = await bindings.DB.prepare("SELECT resolved_at FROM submissions WHERE id = 's1'").first<{
      resolved_at: string;
    }>();
    expect(submission?.resolved_at).toEqual(expect.any(String));
    expect(project?.published_updated_at).toBe(submission?.resolved_at);
    const review = await bindings.DB.prepare(
      "SELECT manifest_hash, checker_version FROM reviews WHERE submission_id = 's1'",
    ).first<Record<string, unknown>>();
    expect(review).toMatchObject({ manifest_hash: "manifest-1", checker_version: "checker-1" });
  });

  it("rejects a review bound to the wrong revision or hash without writing", async () => {
    const wrong = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "approve", revisionId: "other", manifestHash: "manifest-1" }),
      headers: { "content-type": "application/json" },
    });
    expect(wrong.status).toBe(409);
    const wrongHash = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "approve", manifestHash: "other" }),
      headers: { "content-type": "application/json" },
    });
    expect(wrongHash.status).toBe(409);
    const reviews = await bindings.DB.prepare("SELECT COUNT(*) AS n FROM reviews").first<{ n: number }>();
    expect(reviews?.n).toBe(0);
    const project = await bindings.DB.prepare("SELECT published_revision_id FROM projects WHERE id = 'p1'").first<{
      published_revision_id: string | null;
    }>();
    expect(project?.published_revision_id).toBeNull();
  });

  it("requires a reason when the server checker blocked even if the client gate passed", async () => {
    await bindings.DB.prepare(`
      UPDATE submissions SET check_report = ?, check_status = 'needs_human' WHERE id = 's1'
    `)
      .bind(JSON.stringify({ routeGate: "block", findings: [] }))
      .run();
    const missing = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
      headers: { "content-type": "application/json" },
    });
    expect(missing.status).toBe(400);
    const approved = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "approve", reason: "人工复核通过" }),
      headers: { "content-type": "application/json" },
    });
    expect(approved.status).toBe(201);
    const audit = await bindings.DB.prepare(
      "SELECT detail FROM audit_events WHERE target_id = 's1' AND action = 'review.approve'",
    ).first<{ detail: string }>();
    expect(audit?.detail).toContain("人工复核通过");
  });

  it("stores the server review checker revision instead of the client value", async () => {
    await bindings.DB.prepare(
      "UPDATE submissions SET review_checker_revision = 'server-review-1' WHERE id = 's1'",
    ).run();
    const response = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(201);
    const review = await bindings.DB.prepare("SELECT checker_version FROM reviews WHERE submission_id = 's1'").first<{
      checker_version: string;
    }>();
    expect(review?.checker_version).toBe("server-review-1");
  });

  it("ignores client-supplied checker version and report fields", async () => {
    const response = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "approve", checkerVersion: "forged", report: { forged: true } }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(201);
    const review = await bindings.DB.prepare("SELECT checker_version FROM reviews WHERE submission_id = 's1'").first<{
      checker_version: string | null;
    }>();
    expect(review).toEqual({ checker_version: "checker-1" });
  });

  it("returns content diff and queues an explicit recheck", async () => {
    const diff = await request("/submissions/s1/diff");
    expect(diff.status).toBe(200);
    await expect(diff.json()).resolves.toMatchObject({
      revisionId: "r1",
      previousRevisionId: null,
      worldbook: { added: [{ entryKey: expect.any(String) }], unchanged: 0 },
      findings: { accepted: [], changed: [], added: [], removed: [] },
    });

    // The HTTP route starts the checker in the background; queue directly so
    // its state can be inspected before any checker claims the submission.
    const recheck = await workerExports.DataService.authorAdminRecheck("Bearer reviewer-token", "s1");
    expect(recheck).toMatchObject({ kind: "ok" });
    const row = await bindings.DB.prepare("SELECT status, check_status FROM submissions WHERE id = 's1'").first<
      Record<string, unknown>
    >();
    expect(row).toMatchObject({ status: "pending", check_status: "queued" });
    const audit = await bindings.DB.prepare(
      "SELECT action, detail FROM audit_events WHERE target_id = 's1' ORDER BY created_at DESC LIMIT 1",
    ).first<{ action: string; detail: string }>();
    expect(audit?.action).toBe("checker.recheck");
    expect(audit?.detail).toContain("previousRevision");
  });

  it("maps checker findings to message and file and keeps distinct entries apart", async () => {
    const report = (findings: unknown[]) => JSON.stringify({ findings });
    await bindings.DB.prepare(`INSERT INTO project_revisions
      (id, project_id, revision_no, title, created_by) VALUES ('r0', 'p1', 0, 'Previous public version', 'member')`).run();
    await bindings.DB.prepare("UPDATE submissions SET base_published_revision_id = 'r0' WHERE id = 's1'").run();
    await bindings.DB.prepare(`
      INSERT INTO submissions (id, project_id, revision_id, status, client_gate, client_checker_revision, submitted_by, submitted_at, check_report)
      VALUES ('s0', 'p1', 'r0', 'approved', 'warn', 'checker-1', 'member', '2026-10-20T00:00:00.000Z', ?)
    `)
      .bind(
        report([
          {
            ruleId: "L1",
            severity: "high",
            title: "未闭合的 EJS 标签",
            detail: "旧 detail",
            book: "worldbook.json",
            entry: "序章",
            entryId: "0:worldbook.json:1",
            line: 1,
          },
          {
            ruleId: "L2",
            severity: "warn",
            title: "旧标题",
            detail: "旧说明",
            book: "worldbook.json",
            entry: "序章",
            entryId: "0:worldbook.json:1",
            line: 2,
          },
          {
            ruleId: "L3",
            severity: "warn",
            title: "将被移除",
            book: "worldbook.json",
            entry: "附录",
            entryId: "0:worldbook.json:2",
            line: 3,
          },
        ]),
      )
      .run();
    await bindings.DB.prepare("UPDATE submissions SET check_report = ? WHERE id = 's1'")
      .bind(
        report([
          {
            ruleId: "L1",
            severity: "high",
            title: "未闭合的 EJS 标签",
            detail: "旧 detail",
            book: "worldbook.json",
            entry: "序章",
            entryId: "0:worldbook.json:1",
            line: 1,
          },
          {
            ruleId: "L2",
            severity: "high",
            title: "新标题",
            detail: "新说明",
            book: "worldbook.json",
            entry: "序章",
            entryId: "0:worldbook.json:1",
            line: 2,
          },
          {
            ruleId: "U1",
            severity: "warn",
            title: "外部资源需要确认",
            detail: "https://cdn.example/x.png",
            book: "worldbook.json",
            entry: "终章",
            entryId: "0:worldbook.json:3",
            line: 4,
          },
          {
            ruleId: "L1",
            severity: "high",
            title: "另一个条目的未闭合标签",
            book: "worldbook.json",
            entry: "外传",
            entryId: "0:worldbook.json:4",
            line: 1,
          },
        ]),
      )
      .run();
    const diff = await request("/submissions/s1/diff");
    expect(diff.status).toBe(200);
    const body = (await diff.json()) as {
      findings: Record<
        "accepted" | "changed" | "added" | "removed",
        { ruleId: string; severity: string; message: string; file: string | null; line: number | null }[]
      >;
    };
    expect(body.findings.accepted).toEqual([
      {
        ruleId: "L1",
        severity: "high",
        message: "未闭合的 EJS 标签",
        file: "worldbook.json · 序章",
        line: 1,
      },
    ]);
    expect(body.findings.changed).toHaveLength(1);
    expect(body.findings.changed[0]).toMatchObject({
      ruleId: "L2",
      severity: "high",
      message: "新标题",
      file: "worldbook.json · 序章",
      line: 2,
    });
    expect(body.findings.added.map((finding) => `${finding.ruleId}@${finding.file}:${finding.line}`)).toEqual([
      "U1@worldbook.json · 终章:4",
      "L1@worldbook.json · 外传:1",
    ]);
    expect(body.findings.added[0]?.message).toBe("外部资源需要确认");
    expect(body.findings.removed).toHaveLength(1);
    expect(body.findings.removed[0]).toMatchObject({
      ruleId: "L3",
      message: "将被移除",
      file: "worldbook.json · 附录",
    });
  });

  it("requires a reject reason and exposes it to the author", async () => {
    const missing = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "reject" }),
      headers: { "content-type": "application/json" },
    });
    expect(missing.status).toBe(400);
    const rejected = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "reject", reason: "unsafe" }),
      headers: { "content-type": "application/json" },
    });
    expect(rejected.status).toBe(201);

    const headers = { authorization: "Bearer member-token" };
    const mine = await SELF.fetch(new URL("/api/v1/me/projects", "https://workshop.test").toString(), { headers });
    expect(mine.status).toBe(200);
    await expect(mine.json()).resolves.toMatchObject({
      items: [
        {
          project: { id: "p1" },
          latestSubmission: { status: "rejected", decision: "reject", reason: "unsafe" },
        },
      ],
    });
    const history = await SELF.fetch(
      new URL("/api/v1/me/projects/p1/submissions", "https://workshop.test").toString(),
      { headers },
    );
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toMatchObject({
      items: [{ status: "rejected", reason: "unsafe" }],
    });
  });

  it("rejects without changing the published pointer and prevents double review", async () => {
    const first = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "reject", reason: "unsafe" }),
      headers: { "content-type": "application/json" },
    });
    expect(first.status).toBe(201);
    const second = await request("/submissions/s1/review", "reviewer-token", {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
      headers: { "content-type": "application/json" },
    });
    expect(second.status).toBe(409);
    const project = await bindings.DB.prepare("SELECT published_revision_id FROM projects WHERE id = 'p1'").first<{
      published_revision_id: string | null;
    }>();
    expect(project?.published_revision_id).toBeNull();
  });

  it("invalidates changed member sessions and guards the last owner", async () => {
    const changed = await request("/members/reviewer/role", "owner-token", {
      method: "PUT",
      body: JSON.stringify({ role: "member" }),
      headers: { "content-type": "application/json" },
    });
    expect(changed.status).toBe(200);
    expect((await request("/submissions", "reviewer-token")).status).toBe(401);
    const lastOwner = await request("/members/owner/role", "owner-token", {
      method: "PUT",
      body: JSON.stringify({ role: "member" }),
      headers: { "content-type": "application/json" },
    });
    expect(lastOwner.status).toBe(409);
  });
});
