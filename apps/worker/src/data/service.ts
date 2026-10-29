import { WorkerEntrypoint } from "cloudflare:workers";
import { PROJECT_PROJECTIONS } from "../http/public-invalidation";
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

type OperationArgs<T extends unknown[]> = T extends [unknown, ...infer Args] ? Args : never;

export class DataService extends WorkerEntrypoint<DataEnv> {
  private invalidatePublic(paths: string[]): void {
    this.ctx.waitUntil(
      this.ctx.exports
        .CachedReads({ props: { kind: "public" } })
        .invalidatePublic(paths)
        .catch((error) => {
          console.error("Internal public cache invalidation failed", error);
        }),
    );
  }

  override async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/client/")) return distributionClientAsset(request, this.env);
    if (pathname.startsWith("/api/v1/public-assets/") || pathname.startsWith("/api/v1/assets/")) {
      return distributionImage(request, this.env, this.ctx);
    }
    if (pathname === "/api/v1/site/banner" && request.method === "POST") {
      const response = await distributionBannerUpload(request, this.env);
      if (response.ok) this.invalidatePublic(["/api/v1/site", "/api/v1/home", "/api/v1/public-assets/banners/"]);
      return response;
    }
    if (/^\/api\/v1\/projects\/[^/]+\/(?:revisions\/[^/]+\/files\/[^/]+|gallery\/[^/]+)$/.test(pathname)) {
      const response = await authorAdminFilesFetch(request, this.env);
      if (response.ok && request.method === "PUT" && pathname.includes("/gallery/"))
        this.invalidatePublic(PROJECT_PROJECTIONS);
      return response;
    }
    if (pathname.startsWith("/api/v1/admin/submissions/")) {
      return authorAdmin.authorAdminFetch(request, this.env, this.ctx);
    }
    if (pathname.startsWith("/api/v1/downloads/")) return download(request, this.env, this.ctx);
    return Response.json(
      { error: { code: "not_found", message: "Not found" } },
      {
        status: 404,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }

  healthBindings() {
    return { db: Boolean(this.env.DB), r2: Boolean(this.env.R2) };
  }

  distributionClientChannel(...args: OperationArgs<Parameters<typeof distribution.distributionClientChannel>>) {
    return distribution.distributionClientChannel(this.env, ...args);
  }

  distributionCompanion(...args: OperationArgs<Parameters<typeof distribution.distributionCompanion>>) {
    return distribution.distributionCompanion(this.env, ...args);
  }

  distributionPublishCompanion(...args: OperationArgs<Parameters<typeof distribution.distributionPublishCompanion>>) {
    return distribution.distributionPublishCompanion(this.env, ...args);
  }

  async distributionUpdateSite(...args: OperationArgs<Parameters<typeof distribution.distributionUpdateSite>>) {
    const result = await distribution.distributionUpdateSite(this.env, ...args);
    if (result.kind === "ok") this.invalidatePublic(["/api/v1/site", "/api/v1/home", "/api/v1/public-assets/banners/"]);
    return result;
  }

  identitySession(...args: OperationArgs<Parameters<typeof identity.identitySession>>) {
    return identity.identitySession(this.env, ...args);
  }

  identityRevoke(...args: OperationArgs<Parameters<typeof identity.identityRevoke>>) {
    return identity.identityRevoke(this.env, ...args);
  }

  identityMe(...args: OperationArgs<Parameters<typeof identity.identityMe>>) {
    return identity.identityMe(this.env, ...args);
  }

  identityCreateFlow(...args: OperationArgs<Parameters<typeof identity.identityCreateFlow>>) {
    return identity.identityCreateFlow(this.env, ...args);
  }

  identityFlowStatus(...args: OperationArgs<Parameters<typeof identity.identityFlowStatus>>) {
    return identity.identityFlowStatus(this.env, ...args);
  }

  identityFlowByState(...args: OperationArgs<Parameters<typeof identity.identityFlowByState>>) {
    return identity.identityFlowByState(this.env, ...args);
  }

  identityFlowError(...args: OperationArgs<Parameters<typeof identity.identityFlowError>>) {
    return identity.identityFlowError(this.env, ...args);
  }

  identityAuthorizeFlow(...args: OperationArgs<Parameters<typeof identity.identityAuthorizeFlow>>) {
    return identity.identityAuthorizeFlow(this.env, ...args);
  }

  identityRedeemFlow(...args: OperationArgs<Parameters<typeof identity.identityRedeemFlow>>) {
    return identity.identityRedeemFlow(this.env, ...args);
  }

  authorAdminListProjects(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminListProjects>>) {
    return authorAdmin.authorAdminListProjects(this.env, ...args);
  }

  authorAdminListMembers(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminListMembers>>) {
    return authorAdmin.authorAdminListMembers(this.env, ...args);
  }

  authorAdminListAuditEvents(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminListAuditEvents>>) {
    return authorAdmin.authorAdminListAuditEvents(this.env, ...args);
  }

  authorAdminChangeMemberRole(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminChangeMemberRole>>) {
    return authorAdmin.authorAdminChangeMemberRole(this.env, ...args);
  }

  authorAdminListSubmissions(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminListSubmissions>>) {
    return authorAdmin.authorAdminListSubmissions(this.env, ...args);
  }

  authorAdminGetSubmission(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminGetSubmission>>) {
    return authorAdmin.authorAdminGetSubmission(this.env, ...args);
  }

  authorAdminGetDiff(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminGetDiff>>) {
    return authorAdmin.authorAdminGetDiff(this.env, ...args);
  }

  async authorAdminReview(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminReview>>) {
    const result = await authorAdmin.authorAdminReview(this.env, ...args);
    if (result.kind === "ok" && result.data.kind === "ok") this.invalidatePublic(PROJECT_PROJECTIONS);
    return result;
  }

  async authorAdminUpdateRecommendation(
    ...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminUpdateRecommendation>>
  ) {
    const result = await authorAdmin.authorAdminUpdateRecommendation(this.env, ...args);
    if (result.kind === "ok" && result.data.kind === "ok")
      this.invalidatePublic(["/api/v1/recommendations", "/api/v1/home"]);
    return result;
  }

  async authorAdminDeleteRecommendation(
    ...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminDeleteRecommendation>>
  ) {
    const result = await authorAdmin.authorAdminDeleteRecommendation(this.env, ...args);
    if (result.kind === "ok" && result.data.kind === "ok")
      this.invalidatePublic(["/api/v1/recommendations", "/api/v1/home"]);
    return result;
  }

  async authorAdminCreateReferenceSet(
    ...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminCreateReferenceSet>>
  ) {
    const result = await authorAdmin.authorAdminCreateReferenceSet(this.env, ...args);
    if (result.kind === "ok" && result.data.kind === "ok") this.invalidatePublic(["/api/v1/reference-sets"]);
    return result;
  }

  async authorAdminCreateReferenceVersion(
    ...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminCreateReferenceVersion>>
  ) {
    const result = await authorAdmin.authorAdminCreateReferenceVersion(this.env, ...args);
    if (result.kind === "ok" && result.data.kind === "ok") this.invalidatePublic(["/api/v1/reference-sets"]);
    return result;
  }

  async authorAdminUpdateReferenceSet(
    ...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminUpdateReferenceSet>>
  ) {
    const result = await authorAdmin.authorAdminUpdateReferenceSet(this.env, ...args);
    if (result.kind === "ok" && result.data.kind === "ok") this.invalidatePublic(["/api/v1/reference-sets"]);
    return result;
  }

  authorAdminRecheck(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminRecheck>>) {
    return authorAdmin.authorAdminRecheck(this.env, ...args);
  }

  authorAdminCreateProject(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminCreateProject>>) {
    return authorAdmin.authorAdminCreateProject(this.env, ...args);
  }

  authorAdminGetDraft(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminGetDraft>>) {
    return authorAdmin.authorAdminGetDraft(this.env, ...args);
  }

  authorAdminDeleteEntry(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminDeleteEntry>>) {
    return authorAdmin.authorAdminDeleteEntry(this.env, ...args);
  }

  authorAdminGetGallery(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminGetGallery>>) {
    return authorAdmin.authorAdminGetGallery(this.env, ...args);
  }

  async authorAdminDeleteGallery(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminDeleteGallery>>) {
    const result = await authorAdmin.authorAdminDeleteGallery(this.env, ...args);
    if (result.kind === "ok") this.invalidatePublic(PROJECT_PROJECTIONS);
    return result;
  }

  projectList(...args: OperationArgs<Parameters<typeof projects.projectList>>) {
    return projects.projectList(this.env, ...args);
  }

  projectDiscovery(...args: OperationArgs<Parameters<typeof projects.projectDiscovery>>) {
    return projects.projectDiscovery(this.env, ...args);
  }

  projectRankings(...args: OperationArgs<Parameters<typeof projects.projectRankings>>) {
    return projects.projectRankings(this.env, ...args);
  }

  projectDetail(...args: OperationArgs<Parameters<typeof projects.projectDetail>>) {
    return projects.projectDetail(this.env, ...args);
  }

  projectEntries(...args: OperationArgs<Parameters<typeof projects.projectEntries>>) {
    return projects.projectEntries(this.env, ...args);
  }

  projectPreviewTarget(...args: OperationArgs<Parameters<typeof projects.projectPreviewTarget>>) {
    return projects.projectPreviewTarget(this.env, ...args);
  }

  projectTickets(...args: OperationArgs<Parameters<typeof projects.projectTickets>>) {
    return projects.projectTickets(this.env, ...args);
  }

  projectAcquisition(...args: OperationArgs<Parameters<typeof projects.projectAcquisition>>) {
    return projects.projectAcquisition(this.env, ...args);
  }

  async authorAdminDeleteProject(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminDeleteProject>>) {
    const result = await authorAdmin.authorAdminDeleteProject(this.env, ...args);
    if (result.kind === "ok") this.invalidatePublic(PROJECT_PROJECTIONS);
    return result;
  }

  async authorAdminUpdateVisibility(
    ...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminUpdateVisibility>>
  ) {
    const result = await authorAdmin.authorAdminUpdateVisibility(this.env, ...args);
    if (result.kind === "ok") this.invalidatePublic(PROJECT_PROJECTIONS);
    return result;
  }

  async authorAdminPatchProject(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminPatchProject>>) {
    const result = await authorAdmin.authorAdminPatchProject(this.env, ...args);
    if (result.kind === "ok") this.invalidatePublic(PROJECT_PROJECTIONS);
    return result;
  }

  authorAdminCreateRevision(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminCreateRevision>>) {
    return authorAdmin.authorAdminCreateRevision(this.env, ...args);
  }

  authorAdminPrepareSubmission(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminPrepareSubmission>>) {
    return authorAdmin.authorAdminPrepareSubmission(this.env, ...args);
  }

  authorAdminSubmit(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminSubmit>>) {
    return authorAdmin.authorAdminSubmit(this.env, ...args);
  }

  authorAdminWithdraw(...args: OperationArgs<Parameters<typeof authorAdmin.authorAdminWithdraw>>) {
    return authorAdmin.authorAdminWithdraw(this.env, ...args);
  }

  contentGetTarget(submissionId: string) {
    return content.contentGetTarget(this.env, submissionId);
  }

  contentClaim(submissionId: string) {
    return content.contentClaim(this.env, submissionId);
  }

  contentLoadSubmission(revisionId: string) {
    return content.contentLoadSubmission(this.env, revisionId);
  }

  contentRecordRun(
    submissionId: string,
    route: "block" | "warn" | "pass",
    report: string,
    hash: string,
    durationMs: number,
    checkedAt: string,
  ) {
    return content.contentRecordRun(this.env, submissionId, route, report, hash, durationMs, checkedAt);
  }

  contentNeedsHuman(
    submissionId: string,
    message: string,
    result: { report: string; hash: string; checkedAt: string } | null,
  ) {
    return content.contentNeedsHuman(this.env, submissionId, message, result);
  }

  contentRequeue(submissionId: string, message: string) {
    return content.contentRequeue(this.env, submissionId, message);
  }

  async contentAutoPublish(target: RunTarget, report: string, reportHash: string, checkedAt: string) {
    const published = await content.contentAutoPublish(this.env, target, report, reportHash, checkedAt);
    if (published) this.invalidatePublic(PROJECT_PROJECTIONS);
    return published;
  }

  contentLoadRevision(revisionId: string, projectId: string) {
    return content.contentLoadRevision(this.env, revisionId, projectId);
  }

  contentBaselineConflict(fingerprints: string[]) {
    return content.contentBaselineConflict(this.env, fingerprints);
  }

  async buildScheduledRankings(scheduledTime: number): Promise<void> {
    await buildScheduledRankings(this.env.DB, scheduledTime);
    this.invalidatePublic(["/api/v1/projects/rankings", "/api/v1/projects/discovery", "/api/v1/home"]);
  }

  async cleanupScheduledData(dryRun: boolean, scheduledTime: number) {
    return cleanupScheduledData(this.env.DB, dryRun, scheduledTime);
  }

  async findDueSubmissions(scheduledTime: number): Promise<string[]> {
    return findDueSubmissions(this.env.DB, scheduledTime);
  }
}
