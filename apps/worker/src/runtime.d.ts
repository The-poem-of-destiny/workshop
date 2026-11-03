declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./index");
    durableNamespaces: "ContentService" | "WriteBarrier";
  }
}

interface CacheStorage {
  readonly default: Cache;
}
