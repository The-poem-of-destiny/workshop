import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          APP_VERSION: "test",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    // Avoid parked console RPCs hanging teardown: cloudflare/workers-sdk#15719.
    disableConsoleIntercept: true,
  },
});
