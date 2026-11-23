#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Publish immutable checker bundles to R2 under checker/v/<revision>/.
 * The revision is the manifest hash of all bundle bytes, so a URL pin is
 * content-addressed and can be cached forever.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");
const dist = resolve(import.meta.dirname, "..", "dist");
const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const env = value("env") ?? "staging";
if (env !== "staging" && env !== "production") throw new Error("--env must be staging or production");
if (env === "production" && !args.includes("--allow-production"))
  throw new Error("production publish requires --allow-production");
const bucket = env === "staging" ? "workshop-client-staging" : "workshop-client-prod";
const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8"));
const files = ["browser-checker.js", "upload-checker.mjs", "review-checker.mjs", "NOTICES.txt"];
const types = {
  "browser-checker.js": "text/javascript",
  "upload-checker.mjs": "text/javascript",
  "review-checker.mjs": "text/javascript",
  "NOTICES.txt": "text/plain",
};
const committedManifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "..", "src", "bundle-manifest.json"), "utf8"),
);
if (manifest.revision !== committedManifest.revision) {
  throw new Error("dist/manifest.json does not match committed src/bundle-manifest.json; rebuild first");
}
for (const file of files) {
  const body = readFileSync(resolve(dist, file));
  const digest = createHash("sha256").update(body).digest("hex");
  if (manifest.files[file] !== digest || committedManifest.files?.[file] !== digest) {
    throw new Error(`${file} does not match the committed manifest; rebuild first`);
  }
}
for (const file of files) {
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@workshop/worker",
      "exec",
      "wrangler",
      "r2",
      "object",
      "put",
      `${bucket}/checker/v/${manifest.revision}/${file}`,
      "--file",
      resolve(dist, file),
      "--content-type",
      types[file],
      "--remote",
    ],
    { cwd: root, stdio: "inherit", env: { ...process.env, CI: "1" } },
  );
  if (result.status !== 0) throw new Error(`upload failed for ${file}`);
}
console.log(JSON.stringify({ ok: true, env, revision: manifest.revision, files }));
