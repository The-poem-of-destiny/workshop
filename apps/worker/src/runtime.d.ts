declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./index");
    durableNamespaces: "ContentService";
  }
}

interface CacheStorage {
  readonly default: Cache;
}
