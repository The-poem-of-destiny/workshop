import {
  extractProjectEntries,
  inspectProjectMetadata,
  type ProjectEntryKind,
  validateProjectContentText,
} from "@workshop/domain";
import { analyzeFiles, REVIEW_CHECKER_REVISION, routeGate } from "./content-checker";
import type { Env } from "./env";
import { buildEntryIndex } from "./storage/content-index";

interface RunTarget {
  id: string;
  project_id: string;
  revision_id: string;
  base_published_revision_id: string | null;
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
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function baselineConflict(db: D1Database, text: string): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const refs = extractProjectEntries(parsed, "worldbook");
  if (refs.length === 0) return null;
  const fingerprints = await Promise.all(
    refs.map(async (ref) => {
      const entry = ref.entry;
      const name = String(entry.comment ?? entry.name ?? "")
        .replace(/\r\n/g, "\n")
        .trim();
      const content = String(entry.content ?? "")
        .replace(/\r\n/g, "\n")
        .trim();
      return sha256(JSON.stringify({ name, content }));
    }),
  );
  const match = await db
    .prepare(`
    SELECT display_name FROM reference_items
    WHERE kind = 'worldbook' AND exact_hash IN (${fingerprints.map(() => "?").join(", ")})
    LIMIT 1
  `)
    .bind(...fingerprints)
    .first<{ display_name: string }>();
  return match?.display_name ?? null;
}

export class ContentService implements DurableObject {
  constructor(
    _state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
    let submissionId = "";
    let validateRevision = "";
    let validateProjectId = "";
    let validation: { kind?: unknown; text?: unknown } | null = null;
    try {
      const body = (await request.json()) as {
        submissionId?: unknown;
        validate?: unknown;
        validateRevision?: unknown;
        projectId?: unknown;
      };
      if (typeof body.submissionId === "string") submissionId = body.submissionId;
      if (typeof body.validateRevision === "string") validateRevision = body.validateRevision;
      if (typeof body.projectId === "string") validateProjectId = body.projectId;
      if (body.validate && typeof body.validate === "object") {
        validation = body.validate as { kind?: unknown; text?: unknown };
      }
    } catch {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    if (validateRevision) {
      return this.validateRevision(validateRevision, validateProjectId);
    }
    if (validation) {
      if ((validation.kind !== "worldbook" && validation.kind !== "regex") || typeof validation.text !== "string") {
        return Response.json({ error: "bad_request" }, { status: 400 });
      }
      const result = validateProjectContentText(validation.text, validation.kind as ProjectEntryKind);
      return Response.json(result);
    }
    if (!submissionId) return Response.json({ error: "bad_request" }, { status: 400 });
    return this.runSubmission(submissionId);
  }

  private async runSubmission(submissionId: string): Promise<Response> {
    const db = this.env.DB;
    const target = await db
      .prepare(`
      SELECT id, project_id, revision_id, base_published_revision_id, status, check_status, check_attempts, client_gate,
             review_checker_revision
      FROM submissions WHERE id = ?
    `)
      .bind(submissionId)
      .first<RunTarget>();
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
    const claimed = await db
      .prepare(`
      UPDATE submissions
      SET check_status = 'running', check_lease_until = ?, check_attempts = check_attempts + 1, check_error = NULL
      WHERE id = ? AND status IN ('checking', 'pending')
        AND check_status IN ('queued', 'running')
        AND (check_status = 'queued' OR check_lease_until IS NULL OR check_lease_until < ?)
        AND check_attempts < ?
    `)
      .bind(leaseUntil, submissionId, now, MAX_ATTEMPTS)
      .run();
    if (claimed.meta.changes === 0) return Response.json({ skipped: "not_claimed" });

    try {
      return await this.checkSubmission(target, submissionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = target.check_attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await this.needsHuman(submissionId, message, null);
      } else {
        await db
          .prepare(`
          UPDATE submissions
          SET check_status = 'queued', check_lease_until = NULL, check_error = ?
          WHERE id = ? AND status IN ('checking', 'pending') AND check_status = 'running'
        `)
          .bind(message, submissionId)
          .run();
      }
      return Response.json({ ok: false, error: message, attempts }, { status: 500 });
    }
  }

  private async checkSubmission(target: RunTarget, submissionId: string): Promise<Response> {
    const db = this.env.DB;
    const startedAt = Date.now();
    const assets = await db
      .prepare(`
      SELECT kind, r2_key FROM assets WHERE revision_id = ? AND kind IN ('worldbook', 'regex') ORDER BY kind
    `)
      .bind(target.revision_id)
      .all<{ kind: "worldbook" | "regex"; r2_key: string }>();
    if (assets.results.length === 0) throw new Error("冻结内容没有世界书或正则文件");

    const files = [];
    for (const asset of assets.results) {
      const object = await this.env.R2.get(asset.r2_key);
      if (!object) throw new Error(`冻结文件缺失：${asset.kind}`);
      files.push({ fileName: `${asset.kind}.json`, type: asset.kind, text: await object.text() });
    }

    const report = analyzeFiles(files);
    const metadata = await db
      .prepare(`SELECT title, description, author_note, precautions,
        version_label, tags, cover_position_x, cover_position_y, cover_zoom
        FROM project_revisions WHERE id = ?`)
      .bind(target.revision_id)
      .first<{
        title: string;
        description: string | null;
        author_note: string | null;
        precautions: string | null;
        version_label: string | null;
        tags: string;
        cover_position_x: number;
        cover_position_y: number;
        cover_zoom: number;
      }>();
    if (!metadata) throw new Error("冻结资料缺失");
    const metadataReport = inspectProjectMetadata({
      title: metadata.title,
      description: metadata.description,
      authorNote: metadata.author_note,
      precautions: metadata.precautions,
      versionLabel: metadata.version_label,
      tags: JSON.parse(metadata.tags),
      coverPositionX: metadata.cover_position_x,
      coverPositionY: metadata.cover_position_y,
      coverZoom: metadata.cover_zoom,
    });
    const contentRoute = routeGate(report);
    const route =
      contentRoute === "block" || metadataReport.gate === "block"
        ? "block"
        : contentRoute === "warn" || metadataReport.gate === "warn"
          ? "warn"
          : "pass";
    const storedReport = JSON.stringify({
      ...report,
      metadata: metadataReport,
      routeGate: route,
      reviewCheckerRevision: REVIEW_CHECKER_REVISION,
    });
    const reportHash = await sha256(storedReport);
    const checkedAt = new Date().toISOString();
    await db
      .prepare(`
      INSERT INTO submission_check_runs
        (id, submission_id, review_checker_revision, route_gate, report, report_hash, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        submissionId,
        REVIEW_CHECKER_REVISION,
        route,
        storedReport,
        reportHash,
        Date.now() - startedAt,
        checkedAt,
      )
      .run();

    if (route === "block") {
      await this.needsHuman(submissionId, "自动检查要求人工审核。", {
        report: storedReport,
        hash: reportHash,
        checkedAt,
      });
      return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_REVISION });
    }
    if (target.status === "pending" || target.client_gate === "block" || target.client_gate === "missing") {
      await this.needsHuman(
        submissionId,
        target.status === "pending" ? "人工重检完成，等待审核决定。" : "客户端检查未通过或缺失，转人工审核。",
        {
          report: storedReport,
          hash: reportHash,
          checkedAt,
        },
      );
      return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_REVISION, manual: true });
    }

    await this.autoPublish(target, storedReport, reportHash, checkedAt);
    return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_REVISION });
  }

  private async validateRevision(validateRevision: string, validateProjectId: string): Promise<Response> {
    if (!validateProjectId) return Response.json({ error: "bad_request" }, { status: 400 });
    const assets = await this.env.DB.prepare(
      "SELECT kind, r2_key FROM assets WHERE revision_id = ? AND project_id = ? AND kind IN ('worldbook', 'regex')",
    )
      .bind(validateRevision, validateProjectId)
      .all<{ kind: string; r2_key: string }>();
    const presence: Record<ProjectEntryKind, boolean> = { worldbook: false, regex: false };
    const counts: Record<ProjectEntryKind, number> = { worldbook: 0, regex: 0 };
    const hashes: Partial<Record<ProjectEntryKind, string>> = {};
    let conflict: string | null = null;
    let error: string | null = null;
    for (const asset of assets.results) {
      if (asset.kind !== "worldbook" && asset.kind !== "regex") continue;
      const kind = asset.kind as ProjectEntryKind;
      const object = await this.env.R2.get(asset.r2_key);
      if (!object) {
        error = "项目文件缺失，请重新上传";
        break;
      }
      const text = await object.text();
      const result = validateProjectContentText(text, kind);
      if (!result.valid) {
        error = result.error;
        break;
      }
      presence[kind] = true;
      counts[kind] = result.entryCount;
      hashes[kind] = await sha256(text);
      if (kind === "worldbook") {
        conflict = await baselineConflict(this.env.DB, text);
        if (conflict) break;
      }
    }
    const indexAssets = assets.results.filter(
      (asset): asset is { kind: ProjectEntryKind; r2_key: string } =>
        asset.kind === "worldbook" || asset.kind === "regex",
    );
    const entries = error || conflict ? [] : await buildEntryIndex(this.env.R2, indexAssets);
    return Response.json({ presence, counts, hashes, conflict, error, entries });
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
    `)
      .bind(
        message,
        result?.report ?? null,
        result?.hash ?? null,
        result?.checkedAt ?? null,
        result ? REVIEW_CHECKER_REVISION : null,
        submissionId,
      )
      .run();
  }

  private async autoPublish(target: RunTarget, report: string, reportHash: string, checkedAt: string) {
    const now = new Date().toISOString();
    const results = await this.env.DB.batch([
      // Publish before resolving the submission. All later writes are
      // conditional on this successful pointer transition.
      this.env.DB.prepare(`
        UPDATE projects
        SET published_revision_id = ?, published_at = ?, published_cover_asset_id = NULL,
            title = r.title, description = r.description, author_note = r.author_note,
            project_type = r.project_type, extension_type = r.extension_type,
            search_tags = r.tags, published_schema_version = r.schema_version,
            published_discord_thread_url = r.discord_thread_url,
            version_label = r.version_label, precautions = r.precautions,
            cover_position_x = r.cover_position_x, cover_position_y = r.cover_position_y,
            cover_zoom = r.cover_zoom, metadata_findings = r.metadata_findings,
            metadata_checker_revision = r.metadata_checker_revision,
            metadata_checked_at = r.metadata_checked_at, metadata_checked_by = r.metadata_checked_by,
            row_version = row_version + 1, updated_at = ?
        FROM submissions s
        JOIN project_revisions r ON r.id = s.revision_id
        WHERE projects.id = s.project_id
          AND s.id = ? AND s.status = 'checking' AND s.check_status = 'running'
          AND s.revision_id = ?
          AND projects.deleted_at IS NULL
          AND projects.published_revision_id IS s.base_published_revision_id
          AND projects.published_revision_id IS NOT s.revision_id
      `).bind(target.revision_id, now, now, target.id, target.revision_id),
      this.env.DB.prepare(`
        UPDATE submissions
        SET status = 'approved', check_status = 'done', check_lease_until = NULL,
            resolved_at = ?, checked_at = ?, check_report = ?, check_report_hash = ?,
            review_checker_revision = ?, auto_published_at = ?, check_error = NULL
        WHERE id = ? AND status = 'checking' AND check_status = 'running'
          AND EXISTS (
            SELECT 1 FROM projects
            WHERE id = ? AND deleted_at IS NULL AND published_revision_id = ?
          )
      `).bind(
        now,
        checkedAt,
        report,
        reportHash,
        REVIEW_CHECKER_REVISION,
        now,
        target.id,
        target.project_id,
        target.revision_id,
      ),
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
    if ((results[1]?.meta.changes ?? 0) !== 0) return;

    // A competing publication or deletion invalidated the captured baseline.
    // Keep that outcome as history instead of retrying a stale publication.
    await this.env.DB.batch([
      this.env.DB.prepare(`
          UPDATE submissions
          SET status = 'superseded', resolved_at = ?, check_lease_until = NULL,
              check_error = '发布基线已变化，请创建新修订后重新提交'
          WHERE id = ? AND status = 'checking' AND check_status = 'running'
            AND (
              NOT EXISTS (SELECT 1 FROM projects WHERE id = ?)
              OR EXISTS (
                SELECT 1 FROM projects
                WHERE id = ? AND (
                  deleted_at IS NOT NULL OR published_revision_id IS NOT ?
                )
              )
            )
        `).bind(now, target.id, target.project_id, target.project_id, target.base_published_revision_id),
      this.env.DB.prepare(`
          INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
          SELECT ?, 'review.auto_publish_conflict', 'submission', ?, NULL, ?, ?
          WHERE changes() = 1
        `).bind(
        crypto.randomUUID(),
        target.id,
        JSON.stringify({
          projectId: target.project_id,
          revisionId: target.revision_id,
          basePublishedRevisionId: target.base_published_revision_id,
        }),
        now,
      ),
    ]);
    throw new Error("自动发布前置条件已变化");
  }
}
