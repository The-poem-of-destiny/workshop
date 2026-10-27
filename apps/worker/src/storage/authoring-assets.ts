import type { Session } from "@workshop/contracts";
import {
  extractProjectEntries,
  getProjectEntryKey,
  type ProjectEntryKind,
  validateProjectContentPolicy,
} from "@workshop/domain";
import { z } from "zod";
import { getWorkingRevision, parseTags, revisionValues } from "./authoring-model.js";
import { addRevision, type RevisionAssetInput } from "./authoring-revisions.js";

export interface UploadResult {
  kind: "worldbook" | "regex" | "cover";
  sha256: string;
  bytes: number;
  mime: string;
  r2Key: string;
  rowVersion: number;
}

function removeSerializedEntry(
  raw: unknown,
  kind: ProjectEntryKind,
  entryKey: string,
): { text: string; entryCount: number } | null {
  const array = z.array(z.record(z.string(), z.unknown())).safeParse(raw);
  if (array.success) {
    const next = array.data.filter((value, index) => getProjectEntryKey(kind, value, index) !== entryKey);
    if (next.length === array.data.length) return null;
    return { text: JSON.stringify(next), entryCount: extractProjectEntries(next, kind).length };
  }

  const container = z
    .object({
      entries: z.union([
        z.array(z.record(z.string(), z.unknown())),
        z.record(z.string(), z.record(z.string(), z.unknown())),
      ]),
    })
    .passthrough()
    .safeParse(raw);
  if (container.success) {
    if (Array.isArray(container.data.entries)) {
      const next = container.data.entries.filter((value, index) => getProjectEntryKey(kind, value, index) !== entryKey);
      if (next.length === container.data.entries.length) return null;
      return {
        text: JSON.stringify({ ...container.data, entries: next }),
        entryCount: extractProjectEntries(next, kind).length,
      };
    }
    const next = { ...container.data.entries };
    let removed = false;
    for (const [key, value] of Object.entries(next)) {
      if (getProjectEntryKey(kind, value, 0, key) !== entryKey) continue;
      delete next[key];
      removed = true;
    }
    if (!removed) return null;
    return {
      text: JSON.stringify({ ...container.data, entries: next }),
      entryCount: extractProjectEntries(next, kind).length,
    };
  }

  const single = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!single.success || kind !== "regex" || getProjectEntryKey(kind, single.data, 0) !== entryKey) return null;
  return { text: "[]", entryCount: 0 };
}

export async function deleteProjectEntry(
  db: D1Database,
  r2: R2Bucket,
  session: Session,
  projectId: string,
  revisionId: string,
  kind: ProjectEntryKind,
  entryKey: string,
  expectedVersion: number,
): Promise<{ rowVersion: number; revisionId: string; entryCount: number } | null> {
  const current = await getWorkingRevision(db, projectId, session);
  if (!current || current.row_version !== expectedVersion || current.working_revision_id !== revisionId) return null;
  const submitted = await db
    .prepare("SELECT 1 AS present FROM submissions WHERE revision_id = ?")
    .bind(revisionId)
    .first<{ present: number }>();
  if (submitted) return null;
  const asset = await db
    .prepare(`
    SELECT r2_key, mime FROM assets WHERE revision_id = ? AND kind = ?
  `)
    .bind(revisionId, kind)
    .first<{ r2_key: string; mime: string }>();
  if (!asset) return null;
  const object = await r2.get(asset.r2_key);
  if (!object) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await object.text());
  } catch {
    return null;
  }
  const removed = removeSerializedEntry(raw, kind, entryKey);
  if (!removed) return null;
  if (removed.entryCount === 0) {
    const otherKind = kind === "worldbook" ? "regex" : "worldbook";
    const other = await db
      .prepare("SELECT 1 AS present FROM assets WHERE revision_id = ? AND kind = ? LIMIT 1")
      .bind(revisionId, otherKind)
      .first<{ present: number }>();
    const policy = validateProjectContentPolicy(
      { projectType: current.project_type, tags: parseTags(current.search_tags) },
      {
        worldbook: kind === "worldbook" ? false : Boolean(other?.present),
        regex: kind === "regex" ? false : Boolean(other?.present),
      },
    );
    if (!policy.valid) return null;
  }

  const sourceCounts = await db
    .prepare("SELECT worldbook_count, regex_count FROM project_revisions WHERE id = ?")
    .bind(revisionId)
    .first<{ worldbook_count: number; regex_count: number }>();
  if (!sourceCounts) return null;
  const retained = await db
    .prepare(`
    SELECT kind, r2_key, sha256, bytes, mime FROM assets
    WHERE revision_id = ? AND kind <> ?
  `)
    .bind(revisionId, kind)
    .all<RetainedAssetRow>();

  const nextRevisionId = crypto.randomUUID();
  const body = new TextEncoder().encode(removed.text).buffer;
  const sha256 = await sha256Hex(body);
  const contentKey = assetKey(projectId, nextRevisionId, kind, sha256, asset.mime);
  const assets: RevisionAssetInput[] = [];
  const writtenKeys: string[] = [];
  try {
    for (const retainedAsset of retained.results) {
      // R2 objects are immutable and content-addressed; reuse the same object
      // instead of copying every retained asset into a new revision prefix.
      if (!(await r2.head(retainedAsset.r2_key))) throw new Error(`Retained asset is missing: ${retainedAsset.r2_key}`);
      assets.push({
        kind: retainedAsset.kind,
        r2Key: retainedAsset.r2_key,
        sha256: retainedAsset.sha256,
        bytes: retainedAsset.bytes,
        mime: retainedAsset.mime,
      });
    }
    await r2.put(contentKey, body, { httpMetadata: { contentType: asset.mime } });
    writtenKeys.push(contentKey);
    assets.push({ kind, r2Key: contentKey, sha256, bytes: body.byteLength, mime: asset.mime });

    const revision = await addRevision(db, session, current, expectedVersion, revisionValues(current, {}), {
      revisionId: nextRevisionId,
      counts: {
        worldbook: kind === "worldbook" ? removed.entryCount : sourceCounts.worldbook_count,
        regex: kind === "regex" ? removed.entryCount : sourceCounts.regex_count,
      },
      assets,
    });
    if (!revision) {
      if (writtenKeys.length > 0) await r2.delete(writtenKeys);
      return null;
    }
    return { ...revision, entryCount: removed.entryCount };
  } catch (error) {
    if (writtenKeys.length > 0) await r2.delete(writtenKeys).catch(() => undefined);
    throw error;
  }
}

interface RetainedAssetRow {
  kind: string;
  r2_key: string;
  sha256: string;
  bytes: number;
  mime: string;
}

function assetKey(projectId: string, revisionId: string, kind: string, sha256: string, mime: string): string {
  const ext = extensionForMime(mime);
  return kind === "cover"
    ? `covers/${projectId}/${revisionId}-${sha256}.${ext}`
    : `projects/${projectId}/revisions/${revisionId}/${kind}-${sha256}.${ext}`;
}

async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function upsertAsset(
  db: D1Database,
  r2: R2Bucket,
  projectId: string,
  revisionId: string,
  expectedVersion: number,
  kind: UploadResult["kind"],
  body: ArrayBuffer,
  mime: string,
  entryCount?: number,
): Promise<UploadResult | null> {
  const sha256 = await sha256Hex(body);
  const r2Key = assetKey(projectId, revisionId, kind, sha256, mime);
  // Content-addressed keys make a pre-insert put safe: a frozen revision never
  // points at the new key, and identical bytes reuse the same object.
  await r2.put(r2Key, body, { httpMetadata: { contentType: mime } });

  if (kind !== "cover" && (!Number.isInteger(entryCount) || (entryCount ?? 0) < 0)) {
    throw new Error("Validated entry count is required for content uploads");
  }

  const assetId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [
    db
      .prepare(`INSERT INTO assets (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM projects
        WHERE id = ? AND deleted_at IS NULL AND working_revision_id = ? AND row_version = ?
          AND NOT EXISTS (SELECT 1 FROM submissions WHERE revision_id = ?)
      )
      ON CONFLICT(revision_id, kind) DO UPDATE SET
        id = excluded.id, r2_key = excluded.r2_key, sha256 = excluded.sha256,
        bytes = excluded.bytes, mime = excluded.mime, created_at = excluded.created_at`)
      .bind(
        assetId,
        projectId,
        revisionId,
        kind,
        r2Key,
        sha256,
        body.byteLength,
        mime,
        now,
        projectId,
        revisionId,
        expectedVersion,
        revisionId,
      ),
  ];

  if (kind !== "cover") {
    const column = kind === "worldbook" ? "worldbook_count" : "regex_count";
    statements.push(
      db
        .prepare(`UPDATE project_revisions SET ${column} = ?
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM assets WHERE id = ? AND project_id = ? AND revision_id = ? AND kind = ?
        )`)
        .bind(entryCount, revisionId, assetId, projectId, revisionId, kind),
    );
  }

  statements.push(
    db
      .prepare(`UPDATE projects SET row_version = row_version + 1, updated_at = ?
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM assets WHERE id = ? AND project_id = ? AND revision_id = ? AND kind = ?
      )`)
      .bind(now, projectId, assetId, projectId, revisionId, kind),
  );
  const results = await db.batch(statements);
  if ((results.at(-1)?.meta.changes ?? 0) === 0) return null;
  return { kind, sha256, bytes: body.byteLength, mime, r2Key, rowVersion: expectedVersion + 1 };
}

function extensionForMime(mime: string): string {
  const known: Record<string, string> = {
    "application/json": "json",
    "application/zip": "zip",
    "text/plain": "txt",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return known[mime] ?? "bin";
}
