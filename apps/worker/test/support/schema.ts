import initial from "../../migrations/0001_initial.sql?raw";
import downloadTokens from "../../migrations/0002_download_tokens.sql?raw";
import checkerRuns from "../../migrations/0003_checker_runs.sql?raw";
import checkRunHistory from "../../migrations/0004_check_runs.sql?raw";
import oauthExchange from "../../migrations/0005_oauth_exchange.sql?raw";
import projectMetadata from "../../migrations/0006_project_metadata.sql?raw";
import downloadSessionVersion from "../../migrations/0007_download_session_version.sql?raw";
import likeMetrics from "../../migrations/0008_like_metrics.sql?raw";
import publicCacheEpoch from "../../migrations/0009_public_cache_epoch.sql?raw";
import oauthBrowserBinding from "../../migrations/0010_oauth_browser_binding.sql?raw";
import cacheEpochWriteScope from "../../migrations/0011_cache_epoch_write_scope.sql?raw";
import revisionEntryIndex from "../../migrations/0012_revision_entry_index.sql?raw";
import submissionQueueCursor from "../../migrations/0013_submission_queue_cursor.sql?raw";
import sharedR2Assets from "../../migrations/0014_shared_r2_assets.sql?raw";
import publicationState from "../../migrations/0015_publication_state.sql?raw";
import displayCoverEpoch from "../../migrations/0016_display_cover_epoch.sql?raw";
import publishedDisplayMetadata from "../../migrations/0017_published_display_metadata.sql?raw";
import cacheEpochSeed from "../../migrations/0018_seed_public_cache_epoch.sql?raw";
import publicProjectionEpoch from "../../migrations/0019_public_projection_epoch.sql?raw";
import entryIndexCompletion from "../../migrations/0020_entry_index_completion.sql?raw";
import removeObsoleteState from "../../migrations/0021_remove_obsolete_state.sql?raw";
import projectGallery from "../../migrations/0022_project_gallery.sql?raw";
import catalogMetrics from "../../migrations/0023_catalog_metrics.sql?raw";
import submissionWithdrawal from "../../migrations/0024_submission_withdrawal.sql?raw";
import removePublicCacheEpoch from "../../migrations/0025_remove_public_cache_epoch.sql?raw";
import publishedUpdatedAt from "../../migrations/0026_published_updated_at.sql?raw";
import { splitSql } from "./sql";

export async function applySchema(db: D1Database): Promise<void> {
  for (const source of [
    initial,
    downloadTokens,
    checkerRuns,
    checkRunHistory,
    oauthExchange,
    projectMetadata,
    downloadSessionVersion,
    likeMetrics,
    publicCacheEpoch,
    oauthBrowserBinding,
    cacheEpochWriteScope,
    revisionEntryIndex,
    submissionQueueCursor,
    sharedR2Assets,
    publicationState,
    displayCoverEpoch,
    publishedDisplayMetadata,
    cacheEpochSeed,
    publicProjectionEpoch,
    entryIndexCompletion,
    removeObsoleteState,
    projectGallery,
    catalogMetrics,
    submissionWithdrawal,
    removePublicCacheEpoch,
    publishedUpdatedAt,
  ]) {
    const sql = source.replace(/^\s*--.*$/gm, "").replace(/^\s*PRAGMA\b.*$/gm, "");
    for (const statement of splitSql(sql)) await db.prepare(statement).run();
  }
}
