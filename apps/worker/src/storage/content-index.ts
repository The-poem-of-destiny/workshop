import type { ProjectEntryIndex, ProjectPreview, ProjectPreviewKind } from "@workshop/contracts";
import { extractProjectEntries, type ProjectEntryKind } from "@workshop/domain";

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function entryName(entry: Record<string, unknown>, fallback: string): string {
  for (const value of [entry.name, entry.comment, entry.scriptName]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

interface IndexedAsset {
  kind: ProjectEntryKind;
  r2_key: string;
}

export async function buildEntryIndex(
  r2: R2Bucket,
  assets: ReadonlyArray<IndexedAsset>,
): Promise<ProjectEntryIndex["entries"]> {
  const entries: ProjectEntryIndex["entries"] = [];
  for (const asset of assets) {
    const object = await r2.get(asset.r2_key);
    if (!object) throw new Error(`Content index asset is missing: ${asset.kind}`);
    const text = await object.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`Content index asset is not valid JSON: ${asset.kind}`);
    }
    for (const ref of extractProjectEntries(raw, asset.kind)) {
      const content =
        typeof ref.entry.content === "string"
          ? ref.entry.content
          : typeof ref.entry.replaceString === "string"
            ? ref.entry.replaceString
            : "";
      entries.push({
        kind: asset.kind,
        entryKey: ref.entryKey,
        name: entryName(ref.entry, ref.entryKey),
        contentHash: await hash(content),
        contentLength: Array.from(content).length,
      });
    }
  }
  return entries;
}

export async function getProjectEntryIndex(db: D1Database, projectId: string): Promise<ProjectEntryIndex | null> {
  const target = await db
    .prepare(`
    SELECT p.published_revision_id
    FROM projects p JOIN project_revisions r ON r.id = p.published_revision_id AND r.project_id = p.id
    WHERE p.id = ? AND p.deleted_at IS NULL
      AND p.visibility = 'public' AND r.entry_index_ready = 1
  `)
    .bind(projectId)
    .first<{ published_revision_id: string }>();
  if (!target) return null;

  const indexed = await db
    .prepare(`
    SELECT kind, entry_key, name, content_hash, content_length
    FROM revision_entry_index
    WHERE revision_id = ?
    ORDER BY kind, entry_key
  `)
    .bind(target.published_revision_id)
    .all<{ kind: ProjectEntryKind; entry_key: string; name: string; content_hash: string; content_length: number }>();
  return {
    revisionId: target.published_revision_id,
    entries: indexed.results.map((entry) => ({
      kind: entry.kind,
      entryKey: entry.entry_key,
      name: entry.name,
      contentHash: entry.content_hash,
      contentLength: entry.content_length,
    })),
  };
}

export async function getProjectPreview(
  db: D1Database,
  r2: R2Bucket,
  projectId: string,
  kind: ProjectPreviewKind,
): Promise<ProjectPreview | null> {
  const target = await db
    .prepare(`
      SELECT p.published_revision_id AS revision_id, a.r2_key
      FROM projects p
      JOIN project_revisions r ON r.id = p.published_revision_id AND r.project_id = p.id
      JOIN assets a ON a.revision_id = r.id AND a.kind = ?
      WHERE p.id = ? AND p.deleted_at IS NULL AND p.visibility = 'public'
        AND p.published_revision_id IS NOT NULL AND r.entry_index_ready = 1
    `)
    .bind(kind, projectId)
    .first<{ revision_id: string; r2_key: string }>();
  if (!target) return null;
  const object = await r2.get(target.r2_key);
  if (!object) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await object.text());
  } catch {
    return null;
  }
  const entries = extractProjectEntries(raw, kind).map((ref) => ({
    key: ref.entryKey,
    name: entryName(ref.entry, ref.entryKey),
    content:
      typeof ref.entry.content === "string"
        ? ref.entry.content
        : typeof ref.entry.replaceString === "string"
          ? ref.entry.replaceString
          : "",
  }));
  return { revisionId: target.revision_id, kind, entries };
}
