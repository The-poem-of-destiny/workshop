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
  ]) {
    const sql = source.replace(/^\s*--.*$/gm, "").replace(/^\s*PRAGMA\b.*$/gm, "");
    for (const statement of splitSql(sql)) await db.prepare(statement).run();
  }
}
