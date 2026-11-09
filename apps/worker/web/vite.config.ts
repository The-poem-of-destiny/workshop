import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    react(),
    tailwindcss(),
    ...(command === "serve" && mode === "local-preview" && process.env.PREVIEW_DEBUG_ACCOUNTS
      ? [
          {
            name: "local-preview-accounts",
            configureServer(server) {
              server.middlewares.use("/__preview/accounts", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Cache-Control", "no-store");
                res.end(process.env.PREVIEW_DEBUG_ACCOUNTS);
              });
            },
          } satisfies Plugin,
        ]
      : []),
  ],
  server: {
    proxy:
      mode === "local-preview"
        ? {
            "/api": process.env.PREVIEW_API_ORIGIN ?? "http://127.0.0.1:8800",
            "/assets": process.env.PREVIEW_API_ORIGIN ?? "http://127.0.0.1:8800",
            "/client": process.env.PREVIEW_API_ORIGIN ?? "http://127.0.0.1:8800",
          }
        : undefined,
  },
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    manifest: true,
  },
}));
