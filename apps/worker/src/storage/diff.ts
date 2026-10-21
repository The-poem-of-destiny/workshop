import { extractProjectEntries, type ProjectEntryKind } from "@workshop/domain";

export interface EntryChange {
  entryKey: string;
  name: string;
  changedFields?: string[];
}

export interface KindDiff {
  added: EntryChange[];
  modified: EntryChange[];
  deleted: EntryChange[];
  unchanged: number;
}

export interface SubmissionDiff {
  revisionId: string;
  previousRevisionId: string | null;
  worldbook: KindDiff;
  regex: KindDiff;
  cover: {
    changed: boolean;
    beforeSha256: string | null;
    afterSha256: string | null;
  };
}

interface AssetRow {
  revision_id: string;
  kind: string;
  r2_key: string;
  sha256: string;
}

function entryName(entry: Record<string, unknown>, entryKey: string): string {
  for (const value of [entry.name, entry.comment, entry.scriptName]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return entryKey;
}

function comparable(entry: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(entry).sort()) {
    if (key === "uid") continue;
    copy[key] = entry[key];
  }
  return copy;
}

function diffKind(
  currentText: string | null,
  previousText: string | null,
  kind: ProjectEntryKind,
): KindDiff {
  const current = currentText ? extractProjectEntries(JSON.parse(currentText), kind) : [];
  const previous = previousText ? extractProjectEntries(JSON.parse(previousText), kind) : [];
  const before = new Map(previous.map(ref => [ref.entryKey, ref]));
  const after = new Map(current.map(ref => [ref.entryKey, ref]));
  const added: EntryChange[] = [];
  const modified: EntryChange[] = [];
  const deleted: EntryChange[] = [];
  let unchanged = 0;

  for (const [key, ref] of after) {
    const old = before.get(key);
    if (!old) {
      added.push({ entryKey: key, name: entryName(ref.entry, key) });
      continue;
    }
    const oldValue = comparable(old.entry);
    const newValue = comparable(ref.entry);
    const changedFields = Array.from(new Set([...Object.keys(oldValue), ...Object.keys(newValue)]))
      .filter(field => JSON.stringify(oldValue[field]) !== JSON.stringify(newValue[field]));
    if (changedFields.length > 0) {
      modified.push({ entryKey: key, name: entryName(ref.entry, key), changedFields });
    } else {
      unchanged += 1;
    }
  }
  for (const [key, ref] of before) {
    if (!after.has(key)) deleted.push({ entryKey: key, name: entryName(ref.entry, key) });
  }

  const order = (a: EntryChange, b: EntryChange) => a.entryKey.localeCompare(b.entryKey);
  return {
    added: added.sort(order),
    modified: modified.sort(order),
    deleted: deleted.sort(order),
    unchanged,
  };
}

export async function getSubmissionDiff(
  db: D1Database,
  r2: R2Bucket,
  submissionId: string,
): Promise<SubmissionDiff | null> {
  const target = await db.prepare(`
    SELECT s.revision_id, p.published_revision_id
    FROM submissions s JOIN projects p ON p.id = s.project_id
    WHERE s.id = ?
  `).bind(submissionId).first<{ revision_id: string; published_revision_id: string | null }>();
  if (!target) return null;

  const previousId = target.published_revision_id !== target.revision_id
    ? target.published_revision_id
    : null;
  const rows = await db.prepare(`
    SELECT revision_id, kind, r2_key, sha256 FROM assets
    WHERE revision_id IN (?, ?) AND kind IN ('worldbook', 'regex', 'cover')
  `).bind(target.revision_id, target.published_revision_id ?? target.revision_id)
    .all<AssetRow>();

  const byRevision = new Map<string, Map<string, AssetRow>>();
  for (const row of rows.results) {
    const map = byRevision.get(row.revision_id) ?? new Map<string, AssetRow>();
    map.set(row.kind, row);
    byRevision.set(row.revision_id, map);
  }
  const current = byRevision.get(target.revision_id) ?? new Map<string, AssetRow>();
  const previous = previousId ? byRevision.get(previousId) ?? new Map<string, AssetRow>() : new Map<string, AssetRow>();

  async function text(asset: AssetRow | undefined): Promise<string | null> {
    if (!asset) return null;
    const object = await r2.get(asset.r2_key);
    return object ? object.text() : null;
  }

  const [worldbookBefore, worldbookAfter, regexBefore, regexAfter] = await Promise.all([
    text(previous.get("worldbook")),
    text(current.get("worldbook")),
    text(previous.get("regex")),
    text(current.get("regex")),
  ]);

  const coverBefore = previous.get("cover")?.sha256 ?? null;
  const coverAfter = current.get("cover")?.sha256 ?? null;
  return {
    revisionId: target.revision_id,
    previousRevisionId: previousId,
    worldbook: diffKind(worldbookAfter, worldbookBefore, "worldbook"),
    regex: diffKind(regexAfter, regexBefore, "regex"),
    cover: {
      changed: previousId !== null && coverBefore !== coverAfter,
      beforeSha256: coverBefore,
      afterSha256: coverAfter,
    },
  };
}
