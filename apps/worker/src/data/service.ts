import { WorkerEntrypoint } from "cloudflare:workers";
import { authorAdminFilesFetch } from "./author-admin-files";
import * as authorAdmin from "./author-admin-operations";
import type { RunTarget } from "./content-operations";
import * as content from "./content-operations";
import { distributionImage } from "./distribution-images";
import * as distribution from "./distribution-operations";
import { distributionBannerUpload, distributionClientAsset } from "./distribution-streams";
import { download } from "./download";
import type { DataEnv } from "./env";
import * as identity from "./identity-operations";
import * as projects from "./project-operations";
import { buildScheduledRankings, cleanupScheduledData, findDueSubmissions } from "./scheduled";
import { guardedStorageEnv } from "./storage-guard";

type OperationArgs<T extends unknown[]> = T extends [unknown, ...infer Args] ? Args : never;

export class DataService extends WorkerEntrypoint<DataEnv> {
  private get guardedEnv(): DataEnv {
    return guardedStorageEnv(this.env);
  }

  projectRecommendation(...args: OperationArgs<Parameters<typeof projects.projectRecommendation>>) {
    return projects.projectRecommendation(this.guardedEnv, ...args);
  }

  projectSignals(...args: OperationArgs<Parameters<typeof projects.projectSignals>>) {
    return projects.projectSignals(this.guardedEnv, ...args);
  }
  projectChangeSignal(...args: OperationArgs<Parameters<typeof projects.projectChangeSignal>>) {
    return projects.projectChangeSignal(this.guardedEnv, ...args);
  }

  override async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/client/")) return distributionClientAsset(request, this.guardedEnv);
    if (pathname.startsWith("/api/v1/public-assets/") || pathname.startsWith("/api/v1/assets/")) {
      return distributionImage(request, this.guardedEnv, this.ctx);
    }
    if (pathname === "/api/v1/site/banner" && request.method === "POST") {
      return distributionBannerUpload(request, this.guardedEnv);
    }
    if (/^\/api\/v1\/projects\/[^/]+\/(?:versions\/[^/]+\/files\/[^/]+|gallery\/[^/]+)$/.test(pathname)) {
      return authorAdminFilesFetch(request, this.guardedEnv);
    }
    if (pathname.startsWith("/api/v1/admin/submissions/")) {
      return authorAdmin.authorAdminFetch(request, this.guardedEnv, this.ctx);
    }
    if (pathname.startsWith("/api/v1/downloads/")) return download(request, this.guardedEnv, this.ctx);
    return Response.json(
      { error: { code: "not_found", message: "Not found" } },
      {
        status: 404,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }

  healthBindings() {
    return { db: Boolean(this.guardedEnv.DB), r2: Boolean(this.guardedEnv.R2) };
  }

  distributionClientChannel(...args: OperationArgs<Parameters<typeof distribution.distributionClientChannel>>) {
    return distribution.distributionClientChannel(this.guardedEnv, ...args);
  }

  distributionCompanion(...args: OperationArgs<Parameters<typeof distribution.distributionCompanion>>) {
    return distribution.distributionCompanion(this.guardedEnv, ...args);
  }

  distributionPublishCompanion(...args: OperationArgs<Parameters<typeof distribution.distributionPublishCompanion>>) {
    return distribution.distributionPublishCompanion(this.guardedEnv, ...args);
  }

  async distributionUpdateSite(...args: OperationArgs<Parameters<typeof distribution.distributionUpdateSite>>) {
    const result = await distribution.distributionUpdateSite(this.guardedEnv, ...args);
    return result;
  }

  identitySession(...args: OperationArgs<Parameters<typeof identity.identitySession>>) {
    return identity.identitySession(this.guardedEnv, ...args);
  }

  identityRevoke(...args: OperationArgs<Parameters<typeof identity.identityRevoke>>) {
    return identity.identityRevoke(this.guardedEnv, ...args);
  }

  identityMe(...args: OperationArgs<Parameters<typeof identity.identityMe>>) {
    return identity.identityMe(this.guardedEnv, ...args);
  }

  identityCreateFlow(...args: OperationArgs<Parameters<typeof identity.identityCreateFlow>>) {
    return identity.identityCreateFlow(this.guardedEnv, ...args);
  }

  identityFlowStatus(...args: OperationArgs<Parameters<typeof identity.identityFlowStatus>>) {
    return identity.identityFlowStatus(this.guardedEnv, ...args);
  }

  identityFlowByState(...args: OperationArgs<Parameters<typeof identity.identityFlowByState>>) {
    return identity.identityFlowByState(this.guardedEnv, ...args);
  }

  identityFlowError(...args: OperationArgs<Parameters<typeof identity.identityFlowError>>) {
    return identity.identityFlowError(this.guardedEnv, ...args);
  }

  identityAuthorizeFlow(...args: OperationArgs<Parameters<typeof identity.identityAuthorizeFlow>>) {
    return identity.identityAuthorizeFlow(this.guardedEnv, ...args);
  }

  identityRedeemFlow(...args: OperationArgs<Parameters<typeof identity.identityRedeemFlow>>) {
    return identity.identityRedeemFlow(this.guardedEnv, ...args);
  }

  authorAdminListProjects(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminListProjects>>) {
    return authorAdmin.authorAdminListProjects(this.guardedEnv, ...args);
  }

  authorAdminListMembers(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminListMembers>>) {
    return authorAdmin.authorAdminListMembers(this.guardedEnv, ...args);
  }

  authorAdminListAuditEvents(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminListAuditEvents>>) {
    return authorAdmin.authorAdminListAuditEvents(this.guardedEnv, ...args);
  }

  authorAdminChangeMemberRole(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminChangeMemberRole>>) {
    return authorAdmin.authorAdminChangeMemberRole(this.guardedEnv, ...args);
  }

  authorAdminListSubmissions(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminListSubmissions>>) {
    return authorAdmin.authorAdminListSubmissions(this.guardedEnv, ...args);
  }

  authorAdminGetSubmission(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminGetSubmission>>) {
    return authorAdmin.authorAdminGetSubmission(this.guardedEnv, ...args);
  }

  authorAdminGetDiff(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminGetDiff>>) {
    return authorAdmin.authorAdminGetDiff(this.guardedEnv, ...args);
  }

  async authorAdminReview(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminReview>>) {
    const result = await authorAdmin.authorAdminReview(this.guardedEnv, ...args);
    return result;
  }

  async authorAdminUpdateRecommendation(
    ...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminUpdateRecommendation>>
  ) {
    const result = await authorAdmin.authorAdminUpdateRecommendation(this.guardedEnv, ...args);
    return result;
  }

  async authorAdminDeleteRecommendation(
    ...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminDeleteRecommendation>>
  ) {
    const result = await authorAdmin.authorAdminDeleteRecommendation(this.guardedEnv, ...args);
    return result;
  }

  authorAdminRecheck(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminRecheck>>) {
    return authorAdmin.authorAdminRecheck(this.guardedEnv, ...args);
  }

  authorAdminCreateProject(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminCreateProject>>) {
    return authorAdmin.authorAdminCreateProject(this.guardedEnv, ...args);
  }

  authorAdminGetDraft(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminGetDraft>>) {
    return authorAdmin.authorAdminGetDraft(this.guardedEnv, ...args);
  }

  authorAdminDeleteEntry(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminDeleteEntry>>) {
    return authorAdmin.authorAdminDeleteEntry(this.guardedEnv, ...args);
  }

  authorAdminGetGallery(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminGetGallery>>) {
    return authorAdmin.authorAdminGetGallery(this.guardedEnv, ...args);
  }

  async authorAdminDeleteGallery(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminDeleteGallery>>) {
    const result = await authorAdmin.authorAdminDeleteGallery(this.guardedEnv, ...args);
    return result;
  }

  projectList(...args: OperationArgs<Parameters<typeof projects.projectList>>) {
    return projects.projectList(this.guardedEnv, ...args);
  }

  projectDiscovery(...args: OperationArgs<Parameters<typeof projects.projectDiscovery>>) {
    return projects.projectDiscovery(this.guardedEnv, ...args);
  }

  projectRankings(...args: OperationArgs<Parameters<typeof projects.projectRankings>>) {
    return projects.projectRankings(this.guardedEnv, ...args);
  }

  projectDetail(...args: OperationArgs<Parameters<typeof projects.projectDetail>>) {
    return projects.projectDetail(this.guardedEnv, ...args);
  }

  projectEntries(...args: OperationArgs<Parameters<typeof projects.projectEntries>>) {
    return projects.projectEntries(this.guardedEnv, ...args);
  }

  projectPreviewTarget(...args: OperationArgs<Parameters<typeof projects.projectPreviewTarget>>) {
    return projects.projectPreviewTarget(this.guardedEnv, ...args);
  }

  projectDownloads(...args: OperationArgs<Parameters<typeof projects.projectDownloads>>) {
    return projects.projectDownloads(this.guardedEnv, ...args);
  }

  projectAcquisition(...args: OperationArgs<Parameters<typeof projects.projectAcquisition>>) {
    return projects.projectAcquisition(this.guardedEnv, ...args);
  }

  async authorAdminDeleteProject(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminDeleteProject>>) {
    const result = await authorAdmin.authorAdminDeleteProject(this.guardedEnv, ...args);
    return result;
  }

  async authorAdminUpdateVisibility(
    ...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminUpdateVisibility>>
  ) {
    const result = await authorAdmin.authorAdminUpdateVisibility(this.guardedEnv, ...args);
    return result;
  }

  async authorAdminPatchProject(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminPatchProject>>) {
    const result = await authorAdmin.authorAdminPatchProject(this.guardedEnv, ...args);
    return result;
  }

  authorAdminCreateVersion(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminCreateVersion>>) {
    return authorAdmin.authorAdminCreateVersion(this.guardedEnv, ...args);
  }

  authorAdminChangeEvidence(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminChangeEvidence>>) {
    return authorAdmin.authorAdminChangeEvidence(this.guardedEnv, ...args);
  }

  authorAdminPrepareSubmission(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminPrepareSubmission>>) {
    return authorAdmin.authorAdminPrepareSubmission(this.guardedEnv, ...args);
  }

  authorAdminSubmit(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminSubmit>>) {
    return authorAdmin.authorAdminSubmit(this.guardedEnv, ...args);
  }

  authorAdminWithdraw(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminWithdraw>>) {
    return authorAdmin.authorAdminWithdraw(this.guardedEnv, ...args);
  }

  contentGetTarget(submissionId: string) {
    return content.contentGetTarget(this.guardedEnv, submissionId);
  }

  contentClaim(submissionId: string) {
    return content.contentClaim(this.guardedEnv, submissionId);
  }

  contentLoadSubmission(versionId: string) {
    return content.contentLoadSubmission(this.guardedEnv, versionId);
  }

  contentRecordRun(
    submissionId: string,
    leaseToken: string,
    route: "block" | "warn" | "pass",
    report: string,
    hash: string,
    durationMs: number,
    checkedAt: string,
  ) {
    return content.contentRecordRun(
      this.guardedEnv,
      submissionId,
      leaseToken,
      route,
      report,
      hash,
      durationMs,
      checkedAt,
    );
  }

  contentNeedsHuman(submissionId: string, message: string, leaseToken: string | null) {
    return content.contentNeedsHuman(this.guardedEnv, submissionId, message, leaseToken);
  }

  contentRequeue(submissionId: string, message: string, leaseToken: string) {
    return content.contentRequeue(this.guardedEnv, submissionId, message, leaseToken);
  }

  async contentAutoPublish(target: RunTarget, leaseToken: string) {
    const published = await content.contentAutoPublish(this.guardedEnv, target, leaseToken);
    return published;
  }

  contentLoadVersion(versionId: string, projectId: string) {
    return content.contentLoadVersion(this.guardedEnv, versionId, projectId);
  }

  async buildScheduledRankings(scheduledTime: number): Promise<void> {
    await buildScheduledRankings(this.guardedEnv.DB, scheduledTime, this.env.RECOMMENDATION_POLICY);
  }

  async cleanupScheduledData(scheduledTime: number) {
    return cleanupScheduledData(this.guardedEnv.DB, scheduledTime);
  }

  async findDueSubmissions(scheduledTime: number): Promise<string[]> {
    return findDueSubmissions(this.guardedEnv.DB, scheduledTime);
  }
}
