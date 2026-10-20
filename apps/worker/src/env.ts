export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ASSETS?: Fetcher;
  APP_VERSION?: string;
  ALLOWED_ORIGINS?: string;
}
