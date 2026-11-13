import { projectEntryIndexDocumentSchema, type Session, type SubmitProject } from "@workshop/contracts";
import { type ProjectEntryKind, validateProjectContentPresence } from "@workshop/domain";
import { REVIEW_CHECKER_VERSION } from "../content-checker.js";
import type { PrevalidatedContent } from "../data/contracts.js";
import { getWorkingVersion } from "./authoring-model.js";

export type SubmitVersionResult =
  | {
      ok: true;
      submissionId: string;
      status: "pending" | "checking";
      checkStatus: "queued" | "needs_human";
      rowVersion: number;
    }
  | { ok: false; code: "not_found" | "invalid_content" | "conflict"; message: string };

interface VersionAssetRow {
  kind: string;
  r2_key: string;
  sha256: string;
}

function assetSnapshotCondition(versionId: string, assets: readonly VersionAssetRow[]) {
  if (assets.length === 0) {
    return {
      sql: "(SELECT COUNT(*) FROM assets WHERE version_id = ?) = 0",
      bindings: [versionId],
    };
  }
  return {
    sql: `(SELECT COUNT(*) FROM assets WHERE version_id = ?) = ?
      AND NOT EXISTS (
        SELECT 1 FROM assets
        WHERE version_id = ? AND NOT (${assets.map(() => "(kind = ? AND r2_key = ? AND sha256 = ?)").join(" OR ")})
      )`,
    bindings: [
      versionId,
      assets.length,
      versionId,
      ...assets.flatMap((asset) => [asset.kind, asset.r2_key, asset.sha256]),
    ],
  };
}

function validateSubmissionContent(assets: readonly VersionAssetRow[], prevalidated: PrevalidatedContent) {
  const presence: Record<ProjectEntryKind, boolean> = { worldbook: false, regex: false };
  const counts: Record<ProjectEntryKind, number> = { worldbook: 0, regex: 0 };
  let validationError = prevalidated.error;
  for (const kind of ["worldbook", "regex"] as const) {
    const asset = assets.find((item) => item.kind === kind);
    if (Boolean(asset) !== prevalidated.presence[kind] || (asset && prevalidated.hashes[kind] !== asset.sha256)) {
      validationError = "内容在检查期间发生变化，请重新提交";
      break;
    }
    presence[kind] = prevalidated.presence[kind] && prevalidated.counts[kind] > 0;
    counts[kind] = prevalidated.counts[kind];
  }
  if (!validationError) {
    const policy = validateProjectContentPresence(presence);
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

export async function submitVersion(
  db: D1Database,
  session: Session,
  projectId: string,
  versionId: string,
  expectedVersion: number,
  basePublishedVersionId: string | null,
  input: SubmitProject,
  prevalidated: PrevalidatedContent,
): Promise<SubmitVersionResult> {
  const current = await getWorkingVersion(db, projectId, session);
  if (!current || current.working_version_id !== versionId) {
    return { ok: false, code: "not_found", message: "Working revision not found" };
  }
  if (
    current.row_version !== expectedVersion ||
    current.published_version_id !== basePublishedVersionId ||
    current.working_version_frozen
  ) {
    return { ok: false, code: "conflict", message: "Revision is no longer editable" };
  }

  const assets = await db
    .prepare("SELECT kind, r2_key, sha256 FROM assets WHERE version_id = ? ORDER BY kind")
    .bind(versionId)
    .all<VersionAssetRow>();
  const { counts, validationError } = validateSubmissionContent(assets.results, prevalidated);
  if (validationError) return { ok: false, code: "invalid_content", message: validationError };
  const entries = prevalidated.entries;
  const parsedIndex = projectEntryIndexDocumentSchema.safeParse({ schemaVersion: 1, entries });
  if (!parsedIndex.success)
    return { ok: false, code: "invalid_content", message: "Entry index is invalid or exceeds 512000 bytes" };
  const index = JSON.stringify(parsedIndex.data);

  const manifest = assets.results.map((asset) => `${asset.kind}:${asset.sha256}`).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(manifest));
  const manifestHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const submissionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const clientGate = input.gate ?? "missing";
  const checkStatus = clientGate === "pass" || clientGate === "warn" ? "queued" : "needs_human";
  const submissionStatus = checkStatus === "queued" ? "checking" : "pending";
  const snapshot = assetSnapshotCondition(versionId, assets.results);
  const statements: D1PreparedStatement[] = [
    // This marker row is deliberately non-queueable. Every later mutation
    // depends on its unique ID, so a failed CAS cannot write side effects.
    db
      .prepare(`INSERT INTO submissions
        (id, project_id, version_id, status, submitted_by, submitted_at, base_published_version_id)
      SELECT ?, p.id, ?, 'superseded', ?, ?, ?
      FROM projects p
      JOIN project_versions r ON r.id = ? AND r.project_id = p.id
      WHERE p.id = ? AND p.deleted_at IS NULL AND p.working_version_id = ? AND p.row_version = ?
        AND p.published_version_id IS ?
        AND (p.published_version_id IS NULL OR p.published_version_id <> p.working_version_id)
        AND (p.author_id = ? OR ? = 'owner')
        AND NOT EXISTS (SELECT 1 FROM submissions WHERE version_id = ?)
        AND ${snapshot.sql}`)
      .bind(
        submissionId,
        versionId,
        session.userId,
        now,
        basePublishedVersionId,
        versionId,
        projectId,
        versionId,
        expectedVersion,
        basePublishedVersionId,
        session.userId,
        session.role,
        versionId,
        ...snapshot.bindings,
      ),
    db
      .prepare(`INSERT INTO automated_reviews(submission_id,status,client_gate,client_checker_version,checker_version)
      SELECT id,?,?,?,? FROM submissions WHERE id = ? AND status = 'superseded'`)
      .bind(checkStatus, clientGate, input.checkerVersion ?? null, REVIEW_CHECKER_VERSION, submissionId),
    db
      .prepare(`UPDATE project_versions
        SET manifest_hash = ?, worldbook_count = ?, regex_count = ?, entry_index = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = 'superseded')`)
      .bind(manifestHash, counts.worldbook, counts.regex, index, versionId, submissionId),
  ];
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
      SET status = 'superseded', resolved_at = ?, withdrawn_at = ?, withdrawn_by = ?
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
