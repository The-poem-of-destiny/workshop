#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Conservative upper bound, NOT a precise first-screen measurement: count every
// emitted JS/CSS resource, including dynamically imported, non-initial chunks.
// Splitting a chunk must not make its bytes disappear from the budget.
// The existing local feature build measured 254,878 B JS / 21,393 B CSS gzip;
// 320 / 32 KiB leave ~29% / ~53% feature headroom, without lifting Vite warnings.
// These are explicit ceilings, not an automatically rebased size snapshot.
const budgets = { JavaScript: 320 * 1024, CSS: 32 * 1024 };
const totalBudget = 352 * 1024;
const defaultDirectory = fileURLToPath(new URL("../apps/worker/web/dist/", import.meta.url));

function collectSizes(directory, sizes) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported in build output: ${path}`);
    if (entry.isDirectory()) {
      collectSizes(path, sizes);
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    const kind = extension === ".css" ? "CSS" : [".js", ".mjs", ".cjs"].includes(extension) ? "JavaScript" : undefined;
    if (!kind) continue;
    if (!entry.isFile()) throw new Error(`Expected a regular build asset: ${path}`);
    const content = readFileSync(path);
    if (content.byteLength === 0) throw new Error(`Empty build asset: ${path}`);
    sizes[kind].bytes += gzipSync(content).byteLength;
    sizes[kind].files += 1;
  }
}

function main() {
  if (process.argv.length > 3) {
    throw new Error("Usage: node tools/check-bundle-size.mjs [dist-directory]");
  }
  const directory = process.argv[2] ? resolve(process.argv[2]) : defaultDirectory;
  const entry = statSync(join(directory, "index.html"));
  if (!entry.isFile() || entry.size === 0) {
    throw new Error(`Missing frontend entry: ${join(directory, "index.html")}`);
  }
  const sizes = { JavaScript: { bytes: 0, files: 0 }, CSS: { bytes: 0, files: 0 } };
  collectSizes(directory, sizes);

  console.log(`Bundle gzip budget: ${directory}`);
  console.log("Scope: all emitted JS/CSS, including non-initial dynamic chunks; each resource gzipped separately.");
  let failed = false;
  let total = 0;
  for (const [kind, budget] of Object.entries(budgets)) {
    const { bytes, files } = sizes[kind];
    total += bytes;
    console.log(`${kind}: ${bytes} / ${budget} bytes gzip (${files} files)`);
    if (files === 0) {
      console.error(`Missing ${kind} build assets; build the frontend before checking its size.`);
      failed = true;
    }
    if (bytes > budget) {
      console.error(`${kind} gzip budget exceeded by ${bytes - budget} bytes.`);
      failed = true;
    }
  }
  console.log(`Total: ${total} / ${totalBudget} bytes gzip`);
  if (total > totalBudget) {
    console.error(`Total gzip budget exceeded by ${total - totalBudget} bytes.`);
    failed = true;
  }
  if (failed) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`Bundle size check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
