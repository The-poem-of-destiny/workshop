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
