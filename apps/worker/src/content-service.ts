import type { Env } from "./env";
import { analyzeFiles, routeGate, REVIEW_CHECKER_REVISION } from "./content-checker";

interface RunTarget {
  id: string;
  project_id: string;
  revision_id: string;
  status: string;
  check_status: string;
  check_attempts: number;
  client_gate: string | null;
  review_checker_revision: string | null;
}

const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export class ContentService implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
    let submissionId = "";
    try {
      const body = await request.json() as { submissionId?: unknown };
      if (typeof body.submissionId === "string") submissionId = body.submissionId;
    } catch {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    if (!submissionId) return Response.json({ error: "bad_request" }, { status: 400 });

    const db = this.env.DB;
    const target = await db.prepare(`
      SELECT id, project_id, revision_id, status, check_status, check_attempts, client_gate,
             review_checker_revision
      FROM submissions WHERE id = ?
    `).bind(submissionId).first<RunTarget>();
    if (!target) return Response.json({ error: "not_found" }, { status: 404 });
    if (target.status === "approved" || target.status === "rejected" || target.status === "superseded") {
      return Response.json({ skipped: "resolved" });
    }
    if (target.check_attempts >= MAX_ATTEMPTS) {
      await this.needsHuman(submissionId, "检查超时次数已达上限，转人工审核。", null);
      return Response.json({ skipped: "attempts" });
    }
    if (target.check_status === "done" || target.check_status === "needs_human") {
      return Response.json({ skipped: target.check_status });
    }
    if (target.review_checker_revision && target.review_checker_revision !== REVIEW_CHECKER_REVISION) {
      await this.needsHuman(submissionId, "固定检查器版本不可用，转人工审核。", null);
      return Response.json({ skipped: "checker_revision_unavailable" });
    }

    const now = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
    const claimed = await db.prepare(`
      UPDATE submissions
      SET check_status = 'running', check_lease_until = ?, check_attempts = check_attempts + 1, check_error = NULL
      WHERE id = ? AND status IN ('checking', 'pending')
        AND check_status IN ('queued', 'running')
        AND (check_status = 'queued' OR check_lease_until IS NULL OR check_lease_until < ?)
        AND check_attempts < ?
    `).bind(leaseUntil, submissionId, now, MAX_ATTEMPTS).run();
    if (claimed.meta.changes === 0) return Response.json({ skipped: "not_claimed" });

    try {
      const startedAt = Date.now();
      const assets = await db.prepare(`
        SELECT kind, r2_key FROM assets WHERE revision_id = ? AND kind IN ('worldbook', 'regex') ORDER BY kind
      `).bind(target.revision_id).all<{ kind: "worldbook" | "regex"; r2_key: string }>();
      if (assets.results.length === 0) throw new Error("冻结内容没有世界书或正则文件");

      const files = [];
      for (const asset of assets.results) {
        const object = await this.env.R2.get(asset.r2_key);
        if (!object) throw new Error(`冻结文件缺失：${asset.kind}`);
        files.push({ fileName: `${asset.kind}.json`, type: asset.kind, text: await object.text() });
      }

      const report = analyzeFiles(files);
      const route = routeGate(report);
      const storedReport = JSON.stringify({
        ...report,
        routeGate: route,
        reviewCheckerRevision: REVIEW_CHECKER_REVISION,
      });
      const reportHash = await sha256(storedReport);
      const checkedAt = new Date().toISOString();
      await db.prepare(`
        INSERT INTO submission_check_runs
          (id, submission_id, review_checker_revision, route_gate, report, report_hash, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), submissionId, REVIEW_CHECKER_REVISION, route,
        storedReport, reportHash, Date.now() - startedAt, checkedAt,
      ).run();

      if (route === "block") {
        await this.needsHuman(submissionId, "自动检查要求人工审核。", {
          report: storedReport,
          hash: reportHash,
          checkedAt,
        });
        return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_REVISION });
      }
      if (target.client_gate === "block" || target.client_gate === "missing") {
        await this.needsHuman(submissionId, "客户端检查未通过或缺失，转人工审核。", {
          report: storedReport,
          hash: reportHash,
          checkedAt,
        });
        return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_REVISION, manual: true });
      }

      await this.autoPublish(target, storedReport, reportHash, checkedAt);
      return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_REVISION });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = target.check_attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await this.needsHuman(submissionId, message, null);
      } else {
        await db.prepare(`
          UPDATE submissions
          SET check_status = 'queued', check_lease_until = NULL, check_error = ?
          WHERE id = ? AND check_status = 'running'
        `).bind(message, submissionId).run();
      }
      return Response.json({ ok: false, error: message, attempts }, { status: 500 });
    }
  }

  private async needsHuman(
    submissionId: string,
    message: string,
    result: { report: string; hash: string; checkedAt: string } | null,
  ) {
    await this.env.DB.prepare(`
      UPDATE submissions
      SET status = 'pending', check_status = 'needs_human', check_lease_until = NULL,
          check_error = ?, check_report = COALESCE(?, check_report),
          check_report_hash = COALESCE(?, check_report_hash),
          checked_at = COALESCE(?, checked_at),
          review_checker_revision = COALESCE(?, review_checker_revision)
      WHERE id = ? AND status IN ('checking', 'pending')
    `).bind(
      message,
      result?.report ?? null,
      result?.hash ?? null,
      result?.checkedAt ?? null,
      result ? REVIEW_CHECKER_REVISION : null,
      submissionId,
    ).run();
  }

  private async autoPublish(target: RunTarget, report: string, reportHash: string, checkedAt: string) {
    const now = new Date().toISOString();
    const results = await this.env.DB.batch([
      this.env.DB.prepare(`
        UPDATE submissions
        SET status = 'approved', check_status = 'done', check_lease_until = NULL,
            resolved_at = ?, checked_at = ?, check_report = ?, check_report_hash = ?,
            review_checker_revision = ?, auto_published_at = ?, check_error = NULL
        WHERE id = ? AND status = 'checking' AND check_status = 'running'
      `).bind(now, checkedAt, report, reportHash, REVIEW_CHECKER_REVISION, now, target.id),
      this.env.DB.prepare(`
        UPDATE projects
        SET published_revision_id = ?, published_at = ?,
            title = r.title, description = r.description, author_note = r.author_note,
            project_type = r.project_type, extension_type = r.extension_type,
            search_tags = r.tags, row_version = row_version + 1, updated_at = ?
        FROM project_revisions r
        WHERE projects.id = ? AND r.id = ?
          AND projects.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = 'approved')
      `).bind(target.revision_id, now, now, target.project_id, target.revision_id, target.id),
      this.env.DB.prepare(`
        INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        SELECT ?, 'review.auto_publish', 'submission', ?, NULL, ?, ?
        WHERE EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = 'approved')
      `).bind(
        crypto.randomUUID(),
        target.id,
        JSON.stringify({
          projectId: target.project_id,
          revisionId: target.revision_id,
          reviewCheckerRevision: REVIEW_CHECKER_REVISION,
          reportHash,
        }),
        now,
        target.id,
      ),
    ]);
    if ((results[0]?.meta.changes ?? 0) === 0) throw new Error("自动发布状态已变化");
  }
}
