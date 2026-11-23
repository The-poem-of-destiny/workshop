export type CheckerFileType = "worldbook" | "regex";

export interface CheckerFile {
  fileName: string;
  type: CheckerFileType;
  text: string;
}

export interface CheckerFinding {
  ruleId: string;
  severity: "high" | "warn" | "hint" | "info";
  title: string;
  detail: string;
  suggestion: string;
  visibility: string;
  entryId: string;
  book: string;
  entry: string;
  uid: string | number;
  line: number;
  column: number;
  index: number;
  bookOrder: number;
  entryOrder: number;
  relatedEntryIds?: string[];
  riskEvidence?: Record<string, unknown>;
}

export interface CheckerReport {
  generatedAt: string;
  tool: string;
  standard: string;
  engine: string;
  policyVersion: string;
  parserCompatibility: string;
  phase: "local" | "server";
  gate: "accept" | "reject";
  audit: "green" | "yellow" | "not_applicable";
  certification: "pass" | "review" | "fail";
  rules: string;
  files: Array<Record<string, unknown>>;
  findings: CheckerFinding[];
}

export interface ParsedCheckerEntry {
  id: string;
  fileName: string;
  bookOrder: number;
  entryOrder: number;
  key: string;
  uid: string | number;
  name: string;
  rawContent?: string;
  content: string;
  isPrivate: boolean;
  decoratorIssues?: Array<{ text: string; index: number }>;
  hasEjs: boolean;
  sourceType: CheckerFileType;
  symbols: Array<Record<string, unknown>>;
  findRegex?: string;
}

export interface ParsedCheckerBook {
  fileName: string;
  size: number;
  bookOrder: number;
  type: CheckerFileType;
  entries: ParsedCheckerEntry[];
}

export type ExternalLinkUsage = "media" | "navigation" | "network" | "resource" | "unknown";
export type ExternalLinkTrust = "trusted" | "untrusted" | "unknown";

export interface ExternalLinkObservation {
  source: string;
  usage: ExternalLinkUsage;
  index?: number;
  action?: string;
  trust: ExternalLinkTrust;
  reason: string;
  authoritative?: boolean;
}

export interface ExternalLinkRecord {
  url: string;
  hostname: string;
  kind: "http" | "https";
  source: string;
  sources: string[];
  usage: ExternalLinkUsage;
  observations: ExternalLinkObservation[];
}

export interface ExternalLinkReviewItem extends ExternalLinkRecord {
  trust: ExternalLinkTrust;
  reason: string;
  reviewSources: string[];
}

export interface ExternalLinkHostnameGroup {
  hostname: string;
  links: Array<{
    url: string;
    hostname: string;
    sources: string[];
  }>;
}

export interface CollectProjectExternalLinksInput {
  description?: string | null;
  requirements?: { notes?: string | null } | null;
  discordThreadUrl?: string | null;
  allowedGuildIds?: readonly string[];
  worldbookEntries?: readonly Record<string, unknown>[];
  regexEntries?: readonly Record<string, unknown>[];
}

export const CHECKER_VERSION: {
  engine: string;
  policyVersion: string;
  parserCompatibility: string;
};

export function analyzeProjectCodeV2(files: CheckerFile[]): CheckerReport;
export function analyzeLocalProjectCode(files: CheckerFile[]): CheckerReport;
export function toUploaderCodeCheck(report: CheckerReport): {
  standard: string;
  engine: string;
  parserCompatibility: string;
  gate: "accept" | "reject";
  findings: CheckerFinding[];
};
export function formatUploaderCodeCheckError(report: CheckerReport): string;
export function gateStatus(findings: CheckerFinding[]): "accept" | "reject";
export function auditStatus(findings: CheckerFinding[]): "green" | "yellow" | "not_applicable";
export function certificationStatus(findings: CheckerFinding[]): "pass" | "review" | "fail";
export function compareFindings(a: CheckerFinding, b: CheckerFinding): number;
export function finding(
  ruleId: string,
  severity: CheckerFinding["severity"],
  title: string,
  entry: ParsedCheckerEntry | null,
  index: number,
  detail: string,
  suggestion: string,
  extra?: Record<string, unknown>,
): CheckerFinding;
export function inspectDecorators(entry: ParsedCheckerEntry, findings: CheckerFinding[]): void;
export function inspectLinks(
  entry: ParsedCheckerEntry,
  findings: CheckerFinding[],
  parsed: Record<string, unknown>,
): void;
export function parseCodeCheckInput(input: CheckerFile, bookOrder: number): ParsedCheckerBook;
export function collectProjectExternalLinks(input?: CollectProjectExternalLinksInput): ExternalLinkRecord[];
export function externalLinksNeedingReview(records: ExternalLinkRecord[]): ExternalLinkReviewItem[];
export function groupExternalLinksByHostname(records: ExternalLinkRecord[]): ExternalLinkHostnameGroup[];
