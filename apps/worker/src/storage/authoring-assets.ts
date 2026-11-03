import type { Session } from "@workshop/contracts";
import {
  extractProjectEntries,
  getProjectEntryKey,
  type ProjectEntryKind,
  validateProjectContentPolicy,
} from "@workshop/domain";
import { z } from "zod";
import { getWorkingVersion, parseTags, versionValues } from "./authoring-model.js";
import { addVersion, type VersionAssetInput } from "./authoring-versions.js";

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
  versionId: string,
  kind: ProjectEntryKind,
  entryKey: string,
  expectedVersion: number,
): Promise<{ rowVersion: number; versionId: string; entryCount: number } | null> {
  const current = await getWorkingVersion(db, projectId, session);
  if (!current || current.row_version !== expectedVersion || current.working_version_id !== versionId) return null;
  if (current.working_version_frozen) return null;
  const asset = await db
    .prepare(`
    SELECT r2_key, mime FROM assets WHERE version_id = ? AND kind = ?
  `)
    .bind(versionId, kind)
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
      .prepare("SELECT 1 AS present FROM assets WHERE version_id = ? AND kind = ? LIMIT 1")
      .bind(versionId, otherKind)
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
    .prepare("SELECT worldbook_count, regex_count FROM project_versions WHERE id = ?")
    .bind(versionId)
    .first<{ worldbook_count: number; regex_count: number }>();
  if (!sourceCounts) return null;
  const retained = await db
    .prepare(`
    SELECT kind, r2_key, sha256, bytes, mime FROM assets
    WHERE version_id = ? AND kind <> ?
  `)
    .bind(versionId, kind)
    .all<RetainedAssetRow>();

  const nextVersionId = crypto.randomUUID();
  const body = new TextEncoder().encode(removed.text).buffer;
  const sha256 = await sha256Hex(body);
  const contentKey = assetKey(projectId, kind, sha256, asset.mime);
  const assets: VersionAssetInput[] = [];
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
  assets.push({ kind, r2Key: contentKey, sha256, bytes: body.byteLength, mime: asset.mime });

  const revision = await addVersion(db, session, current, expectedVersion, versionValues(current, {}), {
    versionId: nextVersionId,
    counts: {
      worldbook: kind === "worldbook" ? removed.entryCount : sourceCounts.worldbook_count,
      regex: kind === "regex" ? removed.entryCount : sourceCounts.regex_count,
    },
    assets,
  });
  // Failed CAS leaves an immutable orphan; never delete a key another version may share.
  if (!revision) return null;
  return { ...revision, entryCount: removed.entryCount };
}

interface RetainedAssetRow {
  kind: string;
  r2_key: string;
  sha256: string;
  bytes: number;
  mime: string;
}

function assetKey(projectId: string, kind: string, sha256: string, mime: string): string {
  const ext = extensionForMime(mime);
  return kind === "cover" ? `covers/${projectId}/${sha256}.${ext}` : `projects/${projectId}/${kind}-${sha256}.${ext}`;
}

async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function upsertStreamedAsset(
  db: D1Database,
  projectId: string,
  versionId: string,
  expectedVersion: number,
  kind: UploadResult["kind"],
  sha256: string,
  bytes: number,
  mime: string,
  entryCount: number | undefined,
  copyTo: (key: string, options?: R2PutOptions) => Promise<void>,
): Promise<UploadResult | null> {
  const r2Key = assetKey(projectId, kind, sha256, mime);
  await copyTo(r2Key, { httpMetadata: { contentType: mime } });
  return registerAsset(db, projectId, versionId, expectedVersion, kind, sha256, r2Key, bytes, mime, entryCount);
}

async function registerAsset(
  db: D1Database,
  projectId: string,
  versionId: string,
  expectedVersion: number,
  kind: UploadResult["kind"],
  sha256: string,
  r2Key: string,
  bytes: number,
  mime: string,
  entryCount?: number,
): Promise<UploadResult | null> {
  if (kind !== "cover" && (!Number.isInteger(entryCount) || (entryCount ?? 0) < 0)) {
    throw new Error("Validated entry count is required for content uploads");
  }

  const assetId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [
    db
      .prepare(`INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM projects
        WHERE id = ? AND deleted_at IS NULL AND working_version_id = ? AND row_version = ?
          AND (published_version_id IS NULL OR published_version_id <> working_version_id)
          AND NOT EXISTS (SELECT 1 FROM submissions WHERE version_id = ?)
      )
      ON CONFLICT(version_id, kind) DO UPDATE SET
        id = excluded.id, r2_key = excluded.r2_key, sha256 = excluded.sha256,
        bytes = excluded.bytes, mime = excluded.mime, created_at = excluded.created_at`)
      .bind(
        assetId,
        projectId,
        versionId,
        kind,
        r2Key,
        sha256,
        bytes,
        mime,
        now,
        projectId,
        versionId,
        expectedVersion,
        versionId,
      ),
  ];

  if (kind !== "cover") {
    const column = kind === "worldbook" ? "worldbook_count" : "regex_count";
    statements.push(
      db
        .prepare(`UPDATE project_versions SET ${column} = ?
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM assets WHERE id = ? AND project_id = ? AND version_id = ? AND kind = ?
        )`)
        .bind(entryCount, versionId, assetId, projectId, versionId, kind),
    );
  }

  statements.push(
    db
      .prepare(`UPDATE projects SET row_version = row_version + 1, updated_at = ?
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM assets WHERE id = ? AND project_id = ? AND version_id = ? AND kind = ?
      )`)
      .bind(now, projectId, assetId, projectId, versionId, kind),
  );
  const results = await db.batch(statements);
  if ((results.at(-1)?.meta.changes ?? 0) === 0) return null;
  return { kind, sha256, bytes, mime, r2Key, rowVersion: expectedVersion + 1 };
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
