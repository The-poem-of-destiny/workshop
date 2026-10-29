import type { ProjectEntryIndex, ProjectPreview, ProjectPreviewKind } from "@workshop/contracts";
import { extractProjectEntries, type ProjectEntryKind } from "@workshop/domain";
import type { ProjectPreviewTarget } from "../data/contracts.js";

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

function stringItems(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function previewBehavior(
  entry: Record<string, unknown>,
  kind: ProjectPreviewKind,
): NonNullable<ProjectPreview["entries"][number]["behavior"]> {
  if (kind === "regex") {
    return {
      kind,
      scriptName: typeof entry.scriptName === "string" ? entry.scriptName : null,
      findRegex: typeof entry.findRegex === "string" ? entry.findRegex : null,
      disabled:
        entry.disabled === true || entry.disable === true
          ? true
          : entry.disabled === false || entry.disable === false
            ? false
            : null,
      replacementLength: typeof entry.replaceString === "string" ? Array.from(entry.replaceString).length : null,
    };
  }
  const position = sourceRecord(entry.position);
  const strategy = sourceRecord(entry.strategy);
  const secondary = sourceRecord(strategy?.keys_secondary);
  const logic = secondary?.logic ?? entry.selectiveLogic;
  const role = position?.role ?? entry.role;
  const rawPosition = position?.type ?? entry.positionType ?? entry.position_type ?? entry.position;
  return {
    kind,
    keys: stringItems(strategy?.keys ?? (Array.isArray(entry.key) ? entry.key : entry.keys)),
    secondaryKeys: stringItems(
      secondary?.keys ?? (Array.isArray(entry.keysecondary) ? entry.keysecondary : entry.key_secondary),
    ),
    strategy:
      typeof strategy?.type === "string"
        ? strategy.type
        : typeof entry.strategy === "string"
          ? entry.strategy
          : entry.vectorized === true
            ? "vectorized"
            : null,
    constant: typeof entry.constant === "boolean" ? entry.constant : null,
    selective: typeof entry.selective === "boolean" ? entry.selective : null,
    selectiveLogic: typeof logic === "string" ? logic : finiteNumber(logic),
    role: typeof role === "string" ? role : finiteNumber(role),
    outletName: typeof entry.outletName === "string" ? entry.outletName : null,
    position: typeof rawPosition === "string" ? rawPosition : finiteNumber(rawPosition),
    order: finiteNumber(position?.order ?? entry.order),
    depth: finiteNumber(position?.depth ?? entry.depth),
    enabled:
      typeof entry.enabled === "boolean" ? entry.enabled : typeof entry.disable === "boolean" ? !entry.disable : null,
  };
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

export async function resolveProjectPreviewTarget(
  db: D1Database,
  projectId: string,
  kind: ProjectPreviewKind,
): Promise<ProjectPreviewTarget | null> {
  const target = await db
    .prepare(`
      SELECT p.published_revision_id AS revision_id, a.r2_key, a.sha256,
        CASE WHEN ? = 'regex' THEN r.regex_count ELSE r.worldbook_count END AS entry_count
      FROM projects p
      JOIN project_revisions r ON r.id = p.published_revision_id AND r.project_id = p.id
      LEFT JOIN assets a ON a.revision_id = r.id AND a.kind = ?
      WHERE p.id = ? AND p.deleted_at IS NULL AND p.visibility = 'public'
        AND p.published_revision_id IS NOT NULL AND r.entry_index_ready = 1
    `)
    .bind(kind, kind, projectId)
    .first<{ revision_id: string; r2_key: string | null; sha256: string | null; entry_count: number }>();
  if (!target || Boolean(target.r2_key) !== Boolean(target.sha256)) return null;
  if (!target.r2_key && target.entry_count !== 0) return null;
  return {
    projectId,
    revisionId: target.revision_id,
    kind,
    r2Key: target.r2_key,
    sha256: target.sha256,
    entryCount: target.entry_count,
  };
}

export async function loadProjectPreview(r2: R2Bucket, target: ProjectPreviewTarget): Promise<ProjectPreview | null> {
  const { kind, revisionId } = target;
  if (!target.r2Key) return target.entryCount === 0 ? { revisionId, kind, entries: [] } : null;
  const object = await r2.get(target.r2Key);
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
    behavior: previewBehavior(ref.entry, kind),
    content:
      kind === "regex"
        ? typeof ref.entry.replaceString === "string"
          ? ref.entry.replaceString
          : ""
        : typeof ref.entry.content === "string"
          ? ref.entry.content
          : "",
  }));
  return { revisionId, kind, entries };
}
