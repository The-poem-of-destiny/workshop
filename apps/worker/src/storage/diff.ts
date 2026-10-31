import { extractProjectEntries, type ProjectEntryKind } from "@workshop/domain";

export interface EntryChange {
  entryKey: string;
  name: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields?: string[];
}

export interface KindDiff {
  added: EntryChange[];
  modified: EntryChange[];
  deleted: EntryChange[];
  unchanged: number;
  entries: Array<{ entryKey: string; name: string; value: Record<string, unknown> }>;
}

export interface FindingRef {
  ruleId: string;
  severity: string;
  message: string;
  file: string | null;
  line: number | null;
}

export interface FindingDiff {
  accepted: FindingRef[];
  changed: FindingRef[];
  added: FindingRef[];
  removed: FindingRef[];
}

export interface SubmissionDiff {
  revisionId: string;
  previousRevisionId: string | null;
  revisionNo: number;
  previousRevisionNo: number | null;
  findingBaseline: { revisionId: string | null; submissionId: string | null; available: boolean };
  metadata: { before: Record<string, unknown> | null; after: Record<string, unknown> };
  worldbook: KindDiff;
  regex: KindDiff;
  cover: {
    changed: boolean;
    beforeSha256: string | null;
    afterSha256: string | null;
  };
  findings: FindingDiff;
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

function diffKind(currentText: string | null, previousText: string | null, kind: ProjectEntryKind): KindDiff {
  const current = currentText ? extractProjectEntries(JSON.parse(currentText), kind) : [];
  const previous = previousText ? extractProjectEntries(JSON.parse(previousText), kind) : [];
  const before = new Map(previous.map((ref) => [ref.entryKey, ref]));
  const after = new Map(current.map((ref) => [ref.entryKey, ref]));
  const added: EntryChange[] = [];
  const modified: EntryChange[] = [];
  const deleted: EntryChange[] = [];
  let unchanged = 0;

  for (const [key, ref] of after) {
    const old = before.get(key);
    if (!old) {
      added.push({ entryKey: key, name: entryName(ref.entry, key), before: null, after: ref.entry });
      continue;
    }
    const oldValue = comparable(old.entry);
    const newValue = comparable(ref.entry);
    const changedFields = Array.from(new Set([...Object.keys(oldValue), ...Object.keys(newValue)])).filter(
      (field) => JSON.stringify(oldValue[field]) !== JSON.stringify(newValue[field]),
    );
    if (changedFields.length > 0) {
      modified.push({
        entryKey: key,
        name: entryName(ref.entry, key),
        changedFields,
        before: old.entry,
        after: ref.entry,
      });
    } else {
      unchanged += 1;
    }
  }
  for (const [key, ref] of before) {
    if (!after.has(key))
      deleted.push({ entryKey: key, name: entryName(ref.entry, key), before: ref.entry, after: null });
  }

  const order = (a: EntryChange, b: EntryChange) => a.entryKey.localeCompare(b.entryKey);
  return {
    added: added.sort(order),
    modified: modified.sort(order),
    deleted: deleted.sort(order),
    unchanged,
    entries: current.map((ref) => ({
      entryKey: ref.entryKey,
      name: entryName(ref.entry, ref.entryKey),
      value: ref.entry,
    })),
  };
}

/** Checker findings carry title/detail/book/entry rather than a message/file pair. */
function findingText(item: Record<string, unknown>): string {
  for (const field of ["title", "detail"]) {
    const value = Reflect.get(item, field);
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/** `file` combines the book file name with the entry label so distinct entries stay distinct. */
function findingFile(item: Record<string, unknown>): string | null {
  const labels = [Reflect.get(item, "book"), Reflect.get(item, "entry")]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  return labels.length > 0 ? labels.join(" · ") : null;
}

/** Identity of a finding inside one report: the same rule at the same line of the same entry. */
function findingKey(item: Record<string, unknown>, ruleId: string, file: string | null, line: number | null): string {
  const entryId = Reflect.get(item, "entryId");
  const entry = Reflect.get(item, "entry");
  const book = Reflect.get(item, "book");
  const scope =
    typeof entryId === "string" && entryId.trim()
      ? entryId.trim()
      : [typeof book === "string" ? book.trim() : "", typeof entry === "string" ? entry.trim() : ""]
          .filter(Boolean)
          .join("\u0000") ||
        (file ?? "");
  return JSON.stringify([ruleId, scope, line]);
}

interface FindingEntry {
  key: string;
  ref: FindingRef;
}

function findingEntries(report: unknown): FindingEntry[] {
  if (!report || typeof report !== "object") return [];
  const findings = Reflect.get(report, "findings");
  if (!Array.isArray(findings)) return [];
  const entries: FindingEntry[] = [];
  for (const item of findings) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const ruleId = Reflect.get(record, "ruleId");
    if (typeof ruleId !== "string") continue;
    const severity = Reflect.get(record, "severity");
    const rawLine = Reflect.get(record, "line");
    const line = typeof rawLine === "number" && Number.isFinite(rawLine) ? rawLine : null;
    const file = findingFile(record);
    entries.push({
      key: findingKey(record, ruleId, file, line),
      ref: {
        ruleId,
        severity: typeof severity === "string" ? severity : "info",
        message: findingText(record),
        file,
        line,
      },
    });
  }
  return entries;
}

function diffFindings(currentReport: unknown, previousReport: unknown): FindingDiff {
  const current = new Map(findingEntries(currentReport).map((entry) => [entry.key, entry.ref]));
  const previous = new Map(findingEntries(previousReport).map((entry) => [entry.key, entry.ref]));
  const diff: FindingDiff = { accepted: [], changed: [], added: [], removed: [] };
  for (const [key, ref] of current) {
    const old = previous.get(key);
    if (!old) diff.added.push(ref);
    else if (old.severity !== ref.severity || old.message !== ref.message) diff.changed.push(ref);
    else diff.accepted.push(ref);
  }
  for (const [key, ref] of previous) {
    if (!current.has(key)) diff.removed.push(ref);
  }
  return diff;
}

export async function getSubmissionDiff(
  db: D1Database,
  r2: R2Bucket,
  submissionId: string,
): Promise<SubmissionDiff | null> {
  const target = await db
    .prepare(`
    SELECT s.revision_id, s.project_id, s.check_report, s.base_published_revision_id
    FROM submissions s WHERE s.id = ?
  `)
    .bind(submissionId)
    .first<{
      revision_id: string;
      project_id: string;
      check_report: string | null;
      base_published_revision_id: string | null;
    }>();
  if (!target) return null;
  const previousId = target.base_published_revision_id;
  const previousSubmission = previousId
    ? await db
        .prepare(`
    SELECT id, revision_id, check_report FROM submissions
    WHERE project_id = ? AND revision_id = ? AND status = 'approved'
    ORDER BY submitted_at DESC, id DESC LIMIT 1
  `)
        .bind(target.project_id, previousId)
        .first<{ id: string; revision_id: string; check_report: string | null }>()
    : null;
  const revisions = await db
    .prepare(`SELECT * FROM project_revisions WHERE project_id = ? AND id IN (?, ?)`)
    .bind(target.project_id, target.revision_id, previousId ?? target.revision_id)
    .all<Record<string, unknown>>();
  const currentRevision = revisions.results.find((row) => row.id === target.revision_id);
  if (!currentRevision) return null;
  const previousRevision = revisions.results.find((row) => row.id === previousId) ?? null;
  if (previousId && !previousRevision) throw new Error(`Frozen review baseline unavailable: ${previousId}`);
  const currentMetadata: Record<string, unknown> = {};
  const previousMetadata: Record<string, unknown> | null = previousRevision ? {} : null;
  for (const key of [
    "title",
    "description",
    "author_note",
    "project_type",
    "extension_type",
    "tags",
    "schema_version",
    "version_label",
    "precautions",
    "cover_position_x",
    "cover_position_y",
    "cover_zoom",
    "discord_thread_url",
  ]) {
    currentMetadata[key] = currentRevision[key] ?? null;
    if (previousMetadata && previousRevision) previousMetadata[key] = previousRevision[key] ?? null;
  }
  let previousReport: unknown = null;
  try {
    previousReport = previousSubmission?.check_report ? JSON.parse(previousSubmission.check_report) : null;
  } catch {
    previousReport = null;
  }
  let currentReport: unknown = null;
  try {
    currentReport = target.check_report ? JSON.parse(target.check_report) : null;
  } catch {
    currentReport = null;
  }

  const rows = await db
    .prepare(`
    SELECT revision_id, kind, r2_key, sha256 FROM assets
    WHERE revision_id IN (?, ?) AND kind IN ('worldbook', 'regex', 'cover')
  `)
    .bind(target.revision_id, previousId ?? target.revision_id)
    .all<AssetRow>();

  const byRevision = new Map<string, Map<string, AssetRow>>();
  for (const row of rows.results) {
    const map = byRevision.get(row.revision_id) ?? new Map<string, AssetRow>();
    map.set(row.kind, row);
    byRevision.set(row.revision_id, map);
  }
  const current = byRevision.get(target.revision_id) ?? new Map<string, AssetRow>();
  const previous = previousId
    ? (byRevision.get(previousId) ?? new Map<string, AssetRow>())
    : new Map<string, AssetRow>();

  async function text(asset: AssetRow | undefined): Promise<string | null> {
    if (!asset) return null;
    const object = await r2.get(asset.r2_key);
    if (!object) throw new Error(`Frozen review asset unavailable: ${asset.revision_id}/${asset.kind}`);
    return object.text();
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
    revisionNo: Number(currentRevision.revision_no),
    previousRevisionNo: previousRevision ? Number(previousRevision.revision_no) : null,
    findingBaseline: {
      revisionId: previousId,
      submissionId: previousSubmission?.id ?? null,
      available: previousReport !== null,
    },
    metadata: { before: previousMetadata, after: currentMetadata },
    worldbook: diffKind(worldbookAfter, worldbookBefore, "worldbook"),
    regex: diffKind(regexAfter, regexBefore, "regex"),
    cover: {
      changed: coverBefore !== coverAfter,
      beforeSha256: coverBefore,
      afterSha256: coverAfter,
    },
    findings: diffFindings(currentReport, previousReport),
  };
}
