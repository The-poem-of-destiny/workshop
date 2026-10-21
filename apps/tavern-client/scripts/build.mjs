import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const out = path.join(root, "dist");
await mkdir(out, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/index.ts")],
  outfile: path.join(out, "index.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  legalComments: "none",
  sourcemap: false,
  define: {
    __CW_CLIENT_VERSION__: JSON.stringify(packageJson.version),
    __CW_DEFAULT_ORIGIN__: JSON.stringify(
      process.env.CW_DEFAULT_ORIGIN ?? "https://workshop.poem-of-destiny.workers.dev",
    ),
  },
});

const bytes = await readFile(path.join(out, "index.js"));
const sha256 = createHash("sha256").update(bytes).digest("hex");
await writeFile(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      revision: sha256,
      version: packageJson.version,
      size: bytes.byteLength,
    },
    null,
    2,
  ) + "\n",
);
console.log(`tavern client built: ${packageJson.version} ${sha256}`);
