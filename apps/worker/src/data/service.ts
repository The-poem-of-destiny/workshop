import { WorkerEntrypoint } from "cloudflare:workers";
import * as admin from "./admin-operations";
import { authoringFilesFetch } from "./authoring-files";
import * as authoring from "./authoring-operations";
import * as collections from "./collection-operations";
import * as content from "./content-operations";
import type { RunTarget } from "./contracts";
import { distributionImage } from "./distribution-images";
import * as distribution from "./distribution-operations";
import { distributionBannerUpload, distributionClientAsset } from "./distribution-streams";
import { download } from "./download";
import type { DataEnv } from "./env";
import * as identity from "./identity-operations";
import * as projects from "./project-operations";
import { replicatePublicBanner } from "./public-banner";
import { replicatePublicCover, withdrawPublicCover } from "./public-covers";
import { replicatePublicGallery } from "./public-gallery";
import { buildScheduledRecommendationBatch, cleanupScheduledData, findDueSubmissions } from "./scheduled";
import { guardedStorageEnv } from "./storage-guard";

type OperationArgs<T extends unknown[]> = T extends [unknown, ...infer Args] ? Args : never;

export class DataService extends WorkerEntrypoint<DataEnv> {
  private get guardedEnv(): DataEnv {
    return guardedStorageEnv(this.env);
  }

  async backfillPublicImages(projectId: string | null) {
    const env = this.guardedEnv;
    if (!env.PUBLIC_COVERS || !env.PUBLIC_ASSETS_BASE_URL) return null;
    if (projectId === null) {
      await replicatePublicBanner(env);
      return {
        banner:
          (await env.DB.prepare("SELECT phase FROM public_banner_replicas WHERE id = 1").first<string>("phase")) ??
          null,
      };
    }
    await replicatePublicCover(env, projectId);
    await replicatePublicGallery(env, projectId);
    const cover = await env.DB.prepare("SELECT phase FROM public_cover_replicas WHERE project_id = ?")
      .bind(projectId)
      .first<string>("phase");
    const gallery = await env.DB.prepare(
      "SELECT kind, phase FROM public_gallery_replicas WHERE project_id = ? ORDER BY kind",
    )
      .bind(projectId)
      .all<{ kind: string; phase: string }>();
    return { cover, gallery: gallery.results };
  }

  projectRecommendation(...args: OperationArgs<Parameters<typeof projects.projectRecommendation>>) {
    return projects.projectRecommendation(this.guardedEnv, ...args);
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
      return authoringFilesFetch(request, this.guardedEnv);
    }
    if (pathname.startsWith("/api/v1/admin/submissions/")) {
      return admin.adminSubmissionFileFetch(request, this.guardedEnv, this.ctx);
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

  distributionCommunityInviteUrl() {
    return distribution.distributionCommunityInviteUrl(this.guardedEnv);
  }

  authorListCollections(...args: OperationArgs<Parameters<typeof collections.authorListCollections>>) {
    return collections.authorListCollections(this.guardedEnv, ...args);
  }

  authorCreateCollection(...args: OperationArgs<Parameters<typeof collections.authorCreateCollection>>) {
    return collections.authorCreateCollection(this.guardedEnv, ...args);
  }

  authorPatchCollection(...args: OperationArgs<Parameters<typeof collections.authorPatchCollection>>) {
    return collections.authorPatchCollection(this.guardedEnv, ...args);
  }

  authorDeleteCollection(...args: OperationArgs<Parameters<typeof collections.authorDeleteCollection>>) {
    return collections.authorDeleteCollection(this.guardedEnv, ...args);
  }

  authorSetProjectCollections(...args: OperationArgs<Parameters<typeof collections.authorSetProjectCollections>>) {
    return collections.authorSetProjectCollections(this.guardedEnv, ...args);
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

  identityFlowForLaunch(...args: OperationArgs<Parameters<typeof identity.identityFlowForLaunch>>) {
    return identity.identityFlowForLaunch(this.guardedEnv, ...args);
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

  authorAdminListProjects(...args: OperationArgs<Parameters<typeof admin.adminListProjects>>) {
    return admin.adminListProjects(this.guardedEnv, ...args);
  }

  authorAdminListMembers(...args: OperationArgs<Parameters<typeof admin.adminListMembers>>) {
    return admin.adminListMembers(this.guardedEnv, ...args);
  }

  authorAdminListAuditEvents(...args: OperationArgs<Parameters<typeof admin.adminListAuditEvents>>) {
    return admin.adminListAuditEvents(this.guardedEnv, ...args);
  }

  authorAdminChangeMemberRole(...args: OperationArgs<Parameters<typeof admin.adminChangeMemberRole>>) {
    return admin.adminChangeMemberRole(this.guardedEnv, ...args);
  }

  authorAdminListSubmissions(...args: OperationArgs<Parameters<typeof admin.adminListSubmissions>>) {
    return admin.adminListSubmissions(this.guardedEnv, ...args);
  }

  authorAdminGetSubmission(...args: OperationArgs<Parameters<typeof admin.adminGetSubmission>>) {
    return admin.adminGetSubmission(this.guardedEnv, ...args);
  }

  authorAdminGetDiff(...args: OperationArgs<Parameters<typeof admin.adminGetDiff>>) {
    return admin.adminGetDiff(this.guardedEnv, ...args);
  }

  async authorAdminReview(...args: OperationArgs<Parameters<typeof admin.adminReview>>) {
    const result = await admin.adminReview(this.guardedEnv, ...args);
    return result;
  }

  async authorAdminUpdateRecommendation(...args: OperationArgs<Parameters<typeof admin.adminUpdateRecommendation>>) {
    const result = await admin.adminUpdateRecommendation(this.guardedEnv, ...args);
    return result;
  }

  async authorAdminDeleteRecommendation(...args: OperationArgs<Parameters<typeof admin.adminDeleteRecommendation>>) {
    const result = await admin.adminDeleteRecommendation(this.guardedEnv, ...args);
    return result;
  }

  authorAdminRecheck(...args: OperationArgs<Parameters<typeof admin.adminRecheck>>) {
    return admin.adminRecheck(this.guardedEnv, ...args);
  }

  authorAdminCreateProject(...args: OperationArgs<Parameters<typeof authoring.authorCreateProject>>) {
    return authoring.authorCreateProject(this.guardedEnv, ...args);
  }

  authorAdminGetDraft(...args: OperationArgs<Parameters<typeof authoring.authorGetDraft>>) {
    return authoring.authorGetDraft(this.guardedEnv, ...args);
  }

  authorAdminDeleteEntry(...args: OperationArgs<Parameters<typeof authoring.authorDeleteEntry>>) {
    return authoring.authorDeleteEntry(this.guardedEnv, ...args);
  }

  authorAdminGetGallery(...args: OperationArgs<Parameters<typeof authoring.authorGetGallery>>) {
    return authoring.authorGetGallery(this.guardedEnv, ...args);
  }

  async authorAdminDeleteGallery(...args: OperationArgs<Parameters<typeof authoring.authorDeleteGallery>>) {
    const result = await authoring.authorDeleteGallery(this.guardedEnv, ...args);
    return result;
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

  async authorAdminDeleteProject(...args: OperationArgs<Parameters<typeof authoring.authorDeleteProject>>) {
    const result = await authoring.authorDeleteProject(this.guardedEnv, ...args);
    return result;
  }

  async authorAdminUpdateVisibility(...args: OperationArgs<Parameters<typeof authoring.authorUpdateVisibility>>) {
    const result = await authoring.authorUpdateVisibility(this.guardedEnv, ...args);
    return result;
  }

  async authorAdminPatchProject(...args: OperationArgs<Parameters<typeof authoring.authorPatchProject>>) {
    const result = await authoring.authorPatchProject(this.guardedEnv, ...args);
    return result;
  }

  authorAdminCreateVersion(...args: OperationArgs<Parameters<typeof authoring.authorCreateVersion>>) {
    return authoring.authorCreateVersion(this.guardedEnv, ...args);
  }

  authorAdminChangeEvidence(...args: OperationArgs<Parameters<typeof authoring.authorChangeEvidence>>) {
    return authoring.authorChangeEvidence(this.guardedEnv, ...args);
  }

  authorAdminPrepareSubmission(...args: OperationArgs<Parameters<typeof authoring.authorPrepareSubmission>>) {
    return authoring.authorPrepareSubmission(this.guardedEnv, ...args);
  }

  authorAdminSubmit(...args: OperationArgs<Parameters<typeof authoring.authorSubmit>>) {
    return authoring.authorSubmit(this.guardedEnv, ...args);
  }

  authorAdminWithdraw(...args: OperationArgs<Parameters<typeof authoring.authorWithdraw>>) {
    return authoring.authorWithdraw(this.guardedEnv, ...args);
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
    const env = this.guardedEnv;
    if (!(await withdrawPublicCover(env, target.project_id))) throw new Error("Public cover withdrawal pending");
    const published = await content.contentAutoPublish(env, target, leaseToken);
    if (published) await authoring.refreshPublicProjectImages(env, target.project_id);
    return published;
  }

  contentLoadVersion(versionId: string, projectId: string) {
    return content.contentLoadVersion(this.guardedEnv, versionId, projectId);
  }

  async buildScheduledRecommendationBatch(scheduledTime: number): Promise<void> {
    await buildScheduledRecommendationBatch(this.guardedEnv.DB, scheduledTime, this.env.RECOMMENDATION_POLICY);
  }

  async cleanupScheduledData(scheduledTime: number) {
    return cleanupScheduledData(this.guardedEnv.DB, scheduledTime);
  }

  async findDueSubmissions(scheduledTime: number): Promise<string[]> {
    return findDueSubmissions(this.guardedEnv.DB, scheduledTime);
  }
}
