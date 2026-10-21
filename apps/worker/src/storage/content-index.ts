import { extractProjectEntries, type ProjectEntryKind } from "@workshop/domain";
import type { ProjectEntryIndex } from "@workshop/contracts";

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function entryName(entry: Record<string, unknown>, fallback: string): string {
  for (const value of [entry.name, entry.comment, entry.scriptName]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export async function getProjectEntryIndex(
  db: D1Database,
  r2: R2Bucket,
  projectId: string,
): Promise<ProjectEntryIndex | null> {
  const target = await db.prepare(`
    SELECT p.published_revision_id
    FROM projects p
    WHERE p.id = ? AND p.deleted_at IS NULL
      AND p.visibility = 'public' AND p.published_revision_id IS NOT NULL
  `).bind(projectId).first<{ published_revision_id: string }>();
  if (!target) return null;
  const assets = await db.prepare(`
    SELECT kind, r2_key FROM assets
    WHERE revision_id = ? AND kind IN ('worldbook', 'regex')
    ORDER BY kind
  `).bind(target.published_revision_id).all<{ kind: ProjectEntryKind; r2_key: string }>();

  const entries: ProjectEntryIndex["entries"] = [];
  for (const asset of assets.results) {
    const object = await r2.get(asset.r2_key);
    if (!object) continue;
    const text = await object.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      continue;
    }
    for (const ref of extractProjectEntries(raw, asset.kind)) {
      const content = typeof ref.entry.content === "string"
        ? ref.entry.content
        : typeof ref.entry.replaceString === "string" ? ref.entry.replaceString : "";
      entries.push({
        kind: asset.kind,
        entryKey: ref.entryKey,
        name: entryName(ref.entry, ref.entryKey),
        contentHash: await hash(content),
        contentLength: Array.from(content).length,
      });
    }
  }
  return { revisionId: target.published_revision_id, entries };
}
