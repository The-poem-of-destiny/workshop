export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  CONTENT_SERVICE: DurableObjectNamespace;
  ASSETS?: Fetcher;
  APP_VERSION?: string;
  ALLOWED_ORIGINS?: string;
  PUBLIC_ORIGIN?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_ALLOWED_GUILD_IDS?: string;
  DISCORD_GUILD_ROLE_IDS?: string;
  CLEANUP_DRY_RUN?: string;
  SESSION_HASH_SECRET?: string;
  LOG_SAMPLE_RATE?: string;
}
