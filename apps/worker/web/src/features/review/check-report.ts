/**
 * Structured view over the stored checker report.
 *
 * The report shape comes from packages/content/src/ejs-checker/report.mjs:
 * findings carry ruleId/severity/title/detail/suggestion/visibility plus
 * entryId/book/entry/uid/line/column and an optional riskEvidence block.
 */

export interface RiskEvidence {
  action: string;
  usage: string;
  target: string;
  expression: string;
  candidates: string[];
}

export interface CheckFinding {
  ruleId: string;
  severity: "high" | "warn" | "hint" | "info";
  title: string;
  detail: string;
  suggestion: string;
  visibility: string;
  entryId: string;
  book: string;
  entry: string;
  uid: string | number | null;
  line: number | null;
  column: number | null;
  riskEvidence: RiskEvidence | null;
}

export interface CheckReportFile {
  fileName: string;
  type: string;
  size: number | null;
  items: number | null;
  ejsEntries: number | null;
}

export interface MetadataReport {
  gate: string | null;
  findings: { field: string; severity: "warn" | "block"; message: string }[];
}

export interface CheckReport {
  gate: string | null;
  audit: string | null;
  certification: string | null;
  engine: string | null;
  parserCompatibility: string | null;
  generatedAt: string | null;
  routeGate: string | null;
  metadata: MetadataReport | null;
  files: CheckReportFile[];
  findings: CheckFinding[];
  removedFindings: CheckFinding[];
  raw: unknown;
}

export const severityLabels: Record<CheckFinding["severity"], string> = {
  high: "高风险",
  warn: "警告",
  hint: "提示",
  info: "信息",
};

export const gateLabels: Record<string, string> = {
  pass: "通过",
  warn: "需人工确认",
  block: "阻断",
  allow: "通过",
  missing: "缺少检查",
};

/** The checker reports the synthetic file names it receives from the worker. */
export function bookLabel(book: string): string {
  if (book === "worldbook.json") return "世界书";
  if (book === "regex.json") return "正则";
  return book;
}

/** Which report findings block publication (mirrors the checker's gateStatus). */
export function isBlockingFinding(finding: CheckFinding): boolean {
  return finding.severity === "high" && /^L[1-7]$/.test(finding.ruleId);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function severity(value: unknown): CheckFinding["severity"] {
  return value === "high" || value === "warn" || value === "hint" ? value : "info";
}

function riskEvidence(value: unknown): RiskEvidence | null {
  const source = record(value);
  if (!source) return null;
  const candidates = Array.isArray(source.candidates)
    ? source.candidates.map((item) => text(item).trim()).filter(Boolean)
    : [];
  const evidence: RiskEvidence = {
    action: text(source.action),
    usage: text(source.usage),
    target: text(source.target),
    expression: text(source.expression),
    candidates,
  };
  if (!evidence.action && !evidence.usage && !evidence.target && !evidence.expression && candidates.length === 0) {
    return null;
  }
  return evidence;
}

function finding(value: unknown): CheckFinding | null {
  const source = record(value);
  if (!source) return null;
  const ruleId = text(source.ruleId);
  if (!ruleId) return null;
  const uid = source.uid;
  return {
    ruleId,
    severity: severity(source.severity),
    title: text(source.title),
    detail: text(source.detail),
    suggestion: text(source.suggestion),
    visibility: text(source.visibility),
    entryId: text(source.entryId),
    book: text(source.book),
    entry: text(source.entry),
    uid: typeof uid === "string" || typeof uid === "number" ? uid : null,
    line: numeric(source.line),
    column: numeric(source.column),
    riskEvidence: riskEvidence(source.riskEvidence),
  };
}

function findings(value: unknown): CheckFinding[] {
  if (!Array.isArray(value)) return [];
  return value.map(finding).filter((item): item is CheckFinding => item !== null);
}

function files(value: unknown): CheckReportFile[] {
  if (!Array.isArray(value)) return [];
  const parsed: CheckReportFile[] = [];
  for (const item of value) {
    const source = record(item);
    if (!source) continue;
    parsed.push({
      fileName: text(source.fileName),
      type: text(source.type),
      size: numeric(source.size),
      items: numeric(source.items),
      ejsEntries: numeric(source.ejsEntries),
    });
  }
  return parsed;
}

function metadataReport(value: unknown): MetadataReport | null {
  const source = record(value);
  if (!source) return null;
  const items = Array.isArray(source.findings) ? source.findings : [];
  const parsed: MetadataReport["findings"] = [];
  for (const item of items) {
    const entry = record(item);
    if (!entry || (entry.severity !== "warn" && entry.severity !== "block")) continue;
    parsed.push({ field: text(entry.field), severity: entry.severity, message: text(entry.message) });
  }
  return { gate: text(source.gate) || null, findings: parsed };
}

/** Accepts the checker report stored on the submission or on the latest check run. */
export function parseCheckReport(value: unknown): CheckReport | null {
  const source = record(value);
  if (!source) return null;
  const parsed: CheckReport = {
    gate: text(source.gate) || null,
    audit: text(source.audit) || null,
    certification: text(source.certification) || null,
    engine: text(source.engine) || null,
    parserCompatibility: text(source.parserCompatibility) || null,
    generatedAt: text(source.generatedAt) || null,
    routeGate: text(source.routeGate) || null,
    metadata: metadataReport(source.metadata),
    files: files(source.files),
    findings: findings(source.findings),
    removedFindings: findings(source.removedFindings),
    raw: value,
  };
  if (!parsed.findings.length && !parsed.files.length && !parsed.gate && !parsed.routeGate && !parsed.metadata)
    return null;
  return parsed;
}

export interface SeverityCounts {
  high: number;
  warn: number;
  hint: number;
  info: number;
}

export function countSeverities(list: CheckFinding[]): SeverityCounts {
  const counts: SeverityCounts = { high: 0, warn: 0, hint: 0, info: 0 };
  for (const item of list) counts[item.severity] += 1;
  return counts;
}

export interface FindingGroup {
  key: string;
  book: string;
  entry: string;
  entryId: string;
  findings: CheckFinding[];
  blocking: boolean;
}

/** Groups findings by checker entry id, falling back to book/entry labels. */
export function groupFindings(list: CheckFinding[]): FindingGroup[] {
  const groups: FindingGroup[] = [];
  const index = new Map<string, FindingGroup>();
  for (const item of list) {
    const key = item.entryId || [item.book, item.entry].filter(Boolean).join("\u0000") || "file";
    let group = index.get(key);
    if (!group) {
      group = {
        key,
        book: item.book,
        entry: item.entry,
        entryId: item.entryId,
        findings: [],
        blocking: false,
      };
      index.set(key, group);
      groups.push(group);
    }
    group.findings.push(item);
    if (isBlockingFinding(item)) group.blocking = true;
  }
  return groups;
}

export function groupLabel(group: FindingGroup): string {
  return group.entry || group.book || "文件检查";
}

export interface ReadableEvidence {
  focus: string;
  targetLabel: string;
  staticUrl: string;
  dynamic: boolean;
  rawTarget: string;
  urls: string[];
  code: string;
}

const USAGE_FOCUS: Record<string, string> = {
  media:
    "这段代码会在运行时决定图片或视频地址。请确认最终会从哪里加载、地址由什么数据生成，以及这些资源是否确实属于项目功能。",
  navigation: "这段代码会在运行时决定用户将被带往哪里。请确认最终目标、触发条件和用途。",
  network: "这段代码会在运行时决定联网目标。请确认最终会连接哪里、会发送什么数据，以及为什么需要联网。",
};

const USAGE_TARGET_LABEL: Record<string, string> = {
  media: "图片 / 视频 URL",
  navigation: "跳转目标",
  network: "联网目标",
};

/** Port of the legacy getAdminAuditReadableEvidence wording (workshop-legacy admin-review.ts). */
export function readableEvidence(item: CheckFinding): ReadableEvidence | null {
  const evidence = item.riskEvidence;
  if (!evidence) return null;
  const rawTarget = evidence.target;
  const staticUrl = /^(?:https?:)?\/\//i.test(rawTarget) ? rawTarget : "";
  const dynamic = rawTarget === "dynamic";
  const usage = evidence.usage;
  const urls = [...new Set(evidence.candidates.map((value) => value.trim()).filter(Boolean))].slice(0, 6);
  let focus = item.suggestion || "请结合完整内容确认这项行为是否符合项目用途。";
  if (dynamic && USAGE_FOCUS[usage]) focus = USAGE_FOCUS[usage];
  const code = item.ruleId === "AH2" ? "" : item.detail.trim();
  return {
    focus,
    targetLabel: USAGE_TARGET_LABEL[usage] ?? "实际目标",
    staticUrl,
    dynamic,
    rawTarget,
    urls,
    code: code && code !== staticUrl ? code : "",
  };
}

export interface ExternalLinkSummary {
  url: string;
  dynamic: boolean;
  count: number;
  rules: string[];
}

/** Summarizes the external targets the report mentions; static URLs first. */
export function summarizeExternalLinks(report: CheckReport): ExternalLinkSummary[] {
  const seen = new Map<string, ExternalLinkSummary>();
  const add = (url: string, dynamic: boolean, ruleId: string) => {
    const key = `${dynamic ? "dynamic" : "static"}\u0000${url}`;
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.rules.includes(ruleId)) existing.rules.push(ruleId);
      return;
    }
    seen.set(key, { url, dynamic, count: 1, rules: [ruleId] });
  };
  for (const item of report.findings) {
    const evidence = readableEvidence(item);
    if (!evidence) continue;
    if (evidence.staticUrl) add(evidence.staticUrl, false, item.ruleId);
    else if (evidence.dynamic) for (const url of evidence.urls) add(url, true, item.ruleId);
  }
  return [...seen.values()].sort((a, b) => Number(a.dynamic) - Number(b.dynamic) || a.url.localeCompare(b.url));
}

export function formatLine(finding: CheckFinding): string {
  if (finding.line === null) return bookLabel(finding.book) || "未标记位置";
  const column = finding.column !== null && finding.column > 1 ? `，第 ${finding.column} 列` : "";
  return `第 ${finding.line} 行${column}`;
}
