import type { ProjectEntryIndex, Session, SubmitProject } from "@workshop/contracts";
import { type ProjectEntryKind, validateProjectContentPolicy } from "@workshop/domain";
import { REVIEW_CHECKER_REVISION } from "../content-checker.js";
import { getWorkingRevision, parseTags, type WorkingRevisionRow } from "./authoring-model.js";

export interface PrevalidatedContent {
  presence: Record<ProjectEntryKind, boolean>;
  counts: Record<ProjectEntryKind, number>;
  hashes: Partial<Record<ProjectEntryKind, string>>;
  conflict: string | null;
  error: string | null;
  entries: ProjectEntryIndex["entries"];
}

export type SubmitRevisionResult =
  | {
      ok: true;
      submissionId: string;
      status: "pending" | "checking";
      checkStatus: "queued" | "needs_human";
      rowVersion: number;
    }
  | { ok: false; code: "not_found" | "invalid_content" | "conflict"; message: string };

interface RevisionAssetRow {
  kind: string;
  r2_key: string;
  sha256: string;
}

function assetSnapshotCondition(revisionId: string, assets: readonly RevisionAssetRow[]) {
  if (assets.length === 0) {
    return {
      sql: "(SELECT COUNT(*) FROM assets WHERE revision_id = ?) = 0",
      bindings: [revisionId],
    };
  }
  return {
    sql: `(SELECT COUNT(*) FROM assets WHERE revision_id = ?) = ?
      AND NOT EXISTS (
        SELECT 1 FROM assets
        WHERE revision_id = ? AND NOT (${assets.map(() => "(kind = ? AND r2_key = ? AND sha256 = ?)").join(" OR ")})
      )`,
    bindings: [
      revisionId,
      assets.length,
      revisionId,
      ...assets.flatMap((asset) => [asset.kind, asset.r2_key, asset.sha256]),
    ],
  };
}

function validateSubmissionContent(
  current: WorkingRevisionRow,
  assets: readonly RevisionAssetRow[],
  prevalidated: PrevalidatedContent,
) {
  const presence: Record<ProjectEntryKind, boolean> = { worldbook: false, regex: false };
  const counts: Record<ProjectEntryKind, number> = { worldbook: 0, regex: 0 };
  let validationError = prevalidated.error;
  for (const kind of ["worldbook", "regex"] as const) {
    const asset = assets.find((item) => item.kind === kind);
    if (Boolean(asset) !== prevalidated.presence[kind] || (asset && prevalidated.hashes[kind] !== asset.sha256)) {
      validationError = "内容在检查期间发生变化，请重新提交";
      break;
    }
    presence[kind] = prevalidated.presence[kind];
    counts[kind] = prevalidated.counts[kind];
  }
  if (!validationError && prevalidated.conflict) {
    validationError = `世界书条目与官方基线「${prevalidated.conflict}」完全相同，请基于基线修改后再提交`;
  }
  if (!validationError) {
    const policy = validateProjectContentPolicy(
      {
        projectType: current.revision_project_type ?? current.project_type,
        tags: parseTags(current.revision_tags || current.search_tags),
      },
      presence,
    );
    if (!policy.valid) validationError = policy.error;
  }
  if (!validationError) {
    for (const kind of ["worldbook", "regex"] as const) {
      if (prevalidated.entries.filter((entry) => entry.kind === kind).length !== counts[kind]) {
        validationError = "项目文件在建立索引时发生变化，请重新提交";
        break;
      }
    }
  }
  return { counts, validationError };
}

export async function submitRevision(
  db: D1Database,
  session: Session,
  projectId: string,
  revisionId: string,
  expectedVersion: number,
  basePublishedRevisionId: string | null,
  input: SubmitProject,
  prevalidated: PrevalidatedContent,
): Promise<SubmitRevisionResult> {
  const current = await getWorkingRevision(db, projectId, session);
  if (!current || current.working_revision_id !== revisionId) {
    return { ok: false, code: "not_found", message: "Working revision not found" };
  }
  if (
    current.row_version !== expectedVersion ||
    current.published_revision_id !== basePublishedRevisionId ||
    current.working_revision_frozen
  ) {
    return { ok: false, code: "conflict", message: "Revision is no longer editable" };
  }

  const assets = await db
    .prepare("SELECT kind, r2_key, sha256 FROM assets WHERE revision_id = ? ORDER BY kind")
    .bind(revisionId)
    .all<RevisionAssetRow>();
  const { counts, validationError } = validateSubmissionContent(current, assets.results, prevalidated);
  if (validationError) return { ok: false, code: "invalid_content", message: validationError };
  const entries = prevalidated.entries;

  const manifest = assets.results.map((asset) => `${asset.kind}:${asset.sha256}`).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(manifest));
  const manifestHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const submissionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const clientGate = input.gate ?? "missing";
  const checkStatus = clientGate === "pass" || clientGate === "warn" ? "queued" : "needs_human";
  const submissionStatus = checkStatus === "queued" ? "checking" : "pending";
  const snapshot = assetSnapshotCondition(revisionId, assets.results);
  const statements: D1PreparedStatement[] = [
    // This marker row is deliberately non-queueable. Every later mutation
    // depends on its unique ID, so a failed CAS cannot write side effects.
    db
      .prepare(`INSERT INTO submissions
        (id, project_id, revision_id, status, submitted_by, submitted_at,
         client_gate, client_checker_revision, client_warning_count, client_acknowledged_at, check_status,
         review_checker_revision, base_published_revision_id)
      SELECT ?, p.id, ?, 'superseded', ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM projects p
      JOIN project_revisions r ON r.id = ? AND r.project_id = p.id
      WHERE p.id = ? AND p.deleted_at IS NULL AND p.working_revision_id = ? AND p.row_version = ?
        AND p.published_revision_id IS ?
        AND (p.author_id = ? OR ? = 'owner')
        AND NOT EXISTS (SELECT 1 FROM submissions WHERE revision_id = ?)
        AND ${snapshot.sql}`)
      .bind(
        submissionId,
        revisionId,
        session.userId,
        now,
        clientGate,
        input.checkerRevision ?? null,
        input.warningCount,
        input.acknowledged ? now : null,
        checkStatus,
        REVIEW_CHECKER_REVISION,
        basePublishedRevisionId,
        revisionId,
        projectId,
        revisionId,
        expectedVersion,
        basePublishedRevisionId,
        session.userId,
        session.role,
        revisionId,
        ...snapshot.bindings,
      ),
    db
      .prepare(`UPDATE project_revisions
        SET manifest_hash = ?, worldbook_count = ?, regex_count = ?, entry_index_ready = 1
        WHERE id = ? AND EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = 'superseded')`)
      .bind(manifestHash, counts.worldbook, counts.regex, revisionId, submissionId),
    db
      .prepare(`DELETE FROM revision_entry_index
        WHERE revision_id = ? AND EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = 'superseded')`)
      .bind(revisionId, submissionId),
  ];
  for (const entry of entries) {
    statements.push(
      db
        .prepare(`INSERT INTO revision_entry_index
          (revision_id, kind, entry_key, name, content_hash, content_length)
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = 'superseded')`)
        .bind(revisionId, entry.kind, entry.entryKey, entry.name, entry.contentHash, entry.contentLength, submissionId),
    );
  }
  statements.push(
    db
      .prepare(`UPDATE submissions SET status = 'superseded', resolved_at = ?
        WHERE project_id = ? AND id <> ? AND status IN ('pending', 'checking')
          AND EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = 'superseded')`)
      .bind(now, projectId, submissionId, submissionId),
    db
      .prepare(`UPDATE submissions SET status = ?, resolved_at = NULL
        WHERE id = ? AND status = 'superseded'`)
      .bind(submissionStatus, submissionId),
    db
      .prepare(`UPDATE projects SET row_version = row_version + 1, updated_at = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = ?)`)
      .bind(now, projectId, submissionId, submissionStatus),
  );
  const results = await db.batch(statements);
  if ((results.at(-1)?.meta.changes ?? 0) === 0) {
    return { ok: false, code: "conflict", message: "Revision changed while submitting" };
  }
  return { ok: true, submissionId, status: submissionStatus, checkStatus, rowVersion: expectedVersion + 1 };
}

export async function withdrawSubmission(
  db: D1Database,
  session: Session,
  projectId: string,
  submissionId: string,
  expectedVersion: number,
): Promise<{ rowVersion: number; submissionId: string; status: "superseded"; withdrawnAt: string } | null> {
  const now = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(`UPDATE submissions
      SET status = 'superseded', resolved_at = ?, withdrawn_at = ?, withdrawn_by = ?,
          check_lease_until = NULL, check_error = '作者已撤回提交'
      WHERE id = ? AND project_id = ? AND status IN ('pending', 'checking')
        AND EXISTS (SELECT 1 FROM projects p WHERE p.id = submissions.project_id
          AND p.deleted_at IS NULL AND p.row_version = ?
          AND (p.author_id = ? OR ? = 'owner'))`)
      .bind(now, now, session.userId, submissionId, projectId, expectedVersion, session.userId, session.role),
    db
      .prepare(`UPDATE projects SET row_version = row_version + 1
      WHERE id = ? AND changes() = 1`)
      .bind(projectId),
    db
      .prepare(`INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
      SELECT ?, 'submission.withdraw', 'submission', ?, ?, ?, ? WHERE changes() = 1`)
      .bind(crypto.randomUUID(), submissionId, session.userId, JSON.stringify({ projectId }), now),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) return null;
  return { rowVersion: expectedVersion + 1, submissionId, status: "superseded", withdrawnAt: now };
}
