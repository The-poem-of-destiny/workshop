export interface Env {
  CONTENT_SERVICE: WorkerBindings["CONTENT_SERVICE"];
  ASSETS?: WorkerBindings["ASSETS"];
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
  VERSION_METADATA?: { id: string };
  CACHE_TTL_PUBLIC_SECONDS?: string;
  CACHE_TTL_REFERENCE_SECONDS?: string;
  CACHE_TTL_IMMUTABLE_SECONDS?: string;
  CACHE_TTL_INTERNAL_SECONDS?: string;
}
