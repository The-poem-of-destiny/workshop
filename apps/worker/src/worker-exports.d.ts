import type * as MainModule from "./index.js";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof MainModule;
    }
  }
}
