import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist");
await mkdir(out, { recursive: true });

const common = {
  bundle: true,
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  sourcemap: false,
  logLevel: "warning",
};

await build({
  ...common,
  entryPoints: [path.join(root, "src/ejs-checker/upload-worker.mjs")],
  outfile: path.join(out, "upload-checker.mjs"),
  format: "esm",
});
await build({
  ...common,
  entryPoints: [path.join(root, "src/ejs-checker/review-worker.mjs")],
  outfile: path.join(out, "review-checker.mjs"),
  format: "esm",
});
await build({
  ...common,
  entryPoints: [path.join(root, "src/ejs-checker/browser.mjs")],
  outfile: path.join(out, "browser-checker.js"),
  format: "iife",
  globalName: "PoemEjsChecker",
});

const noticeFiles = ["EJS-LICENSE.txt", "EJS-NOTICE.txt", "THIRD-PARTY-NOTICES.txt"];
const notices = await Promise.all(
  noticeFiles.map((file) => readFile(path.join(root, "src/ejs-checker/vendor", file), "utf8")),
);
await writeFile(path.join(out, "NOTICES.txt"), notices.join("\n\n"));

const bundles = ["upload-checker.mjs", "review-checker.mjs", "browser-checker.js"];
const hashes = {};
for (const file of bundles) {
  hashes[file] = createHash("sha256")
    .update(await readFile(path.join(out, file)))
    .digest("hex");
}
const revision = createHash("sha256")
  .update(bundles.map((file) => `${file}:${hashes[file]}`).join("\n"))
  .digest("hex");
const manifest = JSON.stringify({ revision, files: hashes }, null, 2) + "\n";
await writeFile(path.join(out, "manifest.json"), manifest);
await writeFile(path.join(root, "src/bundle-manifest.json"), manifest);
console.log(`content bundles built: ${revision}`);
