import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => {
  const localPreview = command === "serve" && mode === "local-preview";
  const apiOrigin = process.env.PREVIEW_API_ORIGIN;
  if (localPreview && !apiOrigin) {
    throw new Error("PREVIEW_API_ORIGIN is not set; start local preview with `pnpm preview:debug`");
  }
  return {
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [
      react(),
      tailwindcss(),
      ...(localPreview
        ? [
            {
              name: "local-preview-accounts",
              configureServer(server) {
                server.middlewares.use("/__preview/accounts", (_req, res) => {
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("Cache-Control", "no-store");
                  const accounts = process.env.PREVIEW_DEBUG_ACCOUNTS;
                  res.statusCode = accounts ? 200 : 503;
                  res.end(
                    accounts || JSON.stringify({ error: "Use pnpm preview:debug to start local preview accounts" }),
                  );
                });
              },
            } satisfies Plugin,
          ]
        : []),
    ],
    server: {
      proxy: localPreview && apiOrigin ? { "/api": apiOrigin, "/assets": apiOrigin, "/client": apiOrigin } : undefined,
    },
    publicDir: "public",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      manifest: true,
    },
  };
});
