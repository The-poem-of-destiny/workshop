import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        assets: { directory: "./test/fixtures/web", binding: "ASSETS", run_worker_first: true },
        bindings: {
          APP_VERSION: "test",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    maxWorkers: 2,
    // Avoid parked console RPCs hanging teardown: cloudflare/workers-sdk#15719.
    disableConsoleIntercept: true,
  },
});
