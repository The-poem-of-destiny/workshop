import { REVIEW_CHECKER_VERSION } from "../content-checker";
import {
  autoPublishContentReview,
  claimContentReview,
  getContentReviewTarget,
  loadSubmissionContent,
  loadVersionContent,
  markContentReviewNeedsHuman,
  recordContentReviewRun,
  requeueContentReview,
} from "../storage/content-reviews.js";
import type { RunTarget } from "./contracts";

export interface ContentEnv {
  DB: D1Database;
  R2: R2Bucket;
}

export function contentGetTarget(env: ContentEnv, submissionId: string): Promise<RunTarget | null> {
  return getContentReviewTarget(env.DB, submissionId);
}

export function contentClaim(env: ContentEnv, submissionId: string): Promise<string | null> {
  return claimContentReview(env.DB, submissionId);
}

export function contentLoadSubmission(env: ContentEnv, versionId: string) {
  return loadSubmissionContent(env.DB, env.R2, versionId);
}

export function contentRecordRun(
  env: ContentEnv,
  submissionId: string,
  leaseToken: string,
  route: "block" | "warn" | "pass",
  report: string,
  hash: string,
  durationMs: number,
  checkedAt: string,
): Promise<boolean> {
  return recordContentReviewRun(
    env.DB,
    env.R2,
    submissionId,
    leaseToken,
    REVIEW_CHECKER_VERSION,
    route,
    report,
    hash,
    durationMs,
    checkedAt,
  );
}

export function contentNeedsHuman(
  env: ContentEnv,
  submissionId: string,
  message: string,
  leaseToken: string | null,
): Promise<void> {
  return markContentReviewNeedsHuman(env.DB, submissionId, message, leaseToken);
}

export function contentRequeue(
  env: ContentEnv,
  submissionId: string,
  message: string,
  leaseToken: string,
): Promise<void> {
  return requeueContentReview(env.DB, submissionId, message, leaseToken);
}

export function contentLoadVersion(env: ContentEnv, versionId: string, projectId: string) {
  return loadVersionContent(env.DB, env.R2, versionId, projectId);
}

export function contentAutoPublish(env: ContentEnv, target: RunTarget, leaseToken: string) {
  return autoPublishContentReview(env.DB, target, leaseToken);
}
