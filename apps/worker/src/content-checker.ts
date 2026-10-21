import { analyzeProjectCodeV2, type CheckerFile, type CheckerReport } from "@workshop/content";
import bundleManifest from "@workshop/content/bundle-manifest";

export const REVIEW_CHECKER_REVISION = bundleManifest.revision;

export type RouteGate = "pass" | "warn" | "block";

/**
 * Frozen translation from the legacy checker's three independent dimensions
 * into the routing gate. The legacy report is never discarded: the full
 * report, including gate/audit/certification, is stored on the submission.
 */
export function routeGate(report: CheckerReport): RouteGate {
  if (report.gate === "reject") return "block";
  if (report.certification === "fail" || report.certification === "review") return "warn";
  if (report.audit === "yellow") return "warn";
  return "pass";
}

export function analyzeFiles(files: CheckerFile[]): CheckerReport {
  return analyzeProjectCodeV2(files);
}
