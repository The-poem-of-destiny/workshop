#!/usr/bin/env node
/**
 * Copy migration assets into the target R2 key space.
 *
 * Modes:
 *   --target migration.json --manifest out.json
 *       Build an explicit source -> target manifest from transformed assets.
 *   --manifest manifest.json --source-dir <dir> --target-dir <dir>
 *       Rehearse the copy against local directories, verifying bytes/SHA.
 *   --manifest manifest.json --source-bucket <b> --target-bucket <b> --apply
 *       Copy through wrangler with per-object verification and resume.
 *
 * The command never infers a bucket or silently skips a hash mismatch.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hash = value => createHash("sha256").update(value).digest("hex");

function arg(name, fallback) {
  const inline = process.argv.find(value => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

export function validateManifest(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.objects)) {
    throw new Error("manifest.objects must be an array");
  }
  const targets = new Set();
  for (const [index, object] of value.objects.entries()) {
    if (typeof object.sourceKey !== "string" || object.sourceKey.length === 0) throw new Error(`objects[${index}].sourceKey is required`);
    if (typeof object.targetKey !== "string" || object.targetKey.length === 0) throw new Error(`objects[${index}].targetKey is required`);
    if (!/^[a-f0-9]{64}$/i.test(String(object.sha256 ?? ""))) throw new Error(`objects[${index}].sha256 must be 64 hex characters`);
    if (!Number.isInteger(object.bytes) || object.bytes < 0) throw new Error(`objects[${index}].bytes must be a non-negative integer`);
    if (targets.has(object.targetKey)) throw new Error(`duplicate targetKey: ${object.targetKey}`);
    targets.add(object.targetKey);
  }
  return value;
}

export function buildManifest(target) {
  const objects = (target?.tables?.assets ?? []).map(asset => ({
    sourceKey: asset.source_key ?? asset.r2_key,
    targetKey: asset.r2_key,
    sha256: asset.sha256,
    bytes: Number(asset.bytes) || 0,
  }));
  return validateManifest({ format: "workshop-r2-copy-v1", objects });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function wrangler(args, options = {}) {
  const result = spawnSync("pnpm", ["--filter", "@workshop/worker", "exec", "wrangler", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed`);
  return result;
}

function verifyFile(file, object) {
  const bytes = readFileSync(file);
  if (bytes.byteLength !== object.bytes) throw new Error(`${object.sourceKey}: byte mismatch ${bytes.byteLength} != ${object.bytes}`);
  const actual = hash(bytes);
  if (actual !== object.sha256.toLowerCase()) throw new Error(`${object.sourceKey}: sha256 mismatch ${actual}`);
}

export function localCopy(manifest, sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const copied = [];
  for (const object of manifest.objects) {
    const source = join(resolve(sourceDir), object.sourceKey);
    const target = join(resolve(targetDir), object.targetKey);
    if (!existsSync(source)) continue;
    verifyFile(source, object);
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      const bytes = readFileSync(target);
      if (bytes.byteLength === object.bytes && hash(bytes) === object.sha256.toLowerCase()) continue;
    }
    writeFileSync(target, readFileSync(source));
    verifyFile(target, object);
    copied.push(object.targetKey);
  }
  return copied;
}

function remoteCopy(manifest, sourceBucket, targetBucket) {
  const work = join(root, ".wrangler", "r2-copy");
  mkdirSync(work, { recursive: true });
  const copied = [];
  for (const object of manifest.objects) {
    const targetFile = join(work, `target-${hash(object.targetKey).slice(0, 16)}`);
    let targetCurrent = false;
    try {
      wrangler(["r2", "object", "get", `${targetBucket}/${object.targetKey}`, "--file", targetFile, "--remote"], { capture: true });
      const bytes = readFileSync(targetFile);
      targetCurrent = bytes.byteLength === object.bytes && hash(bytes) === object.sha256.toLowerCase();
    } catch {
      targetCurrent = false;
    }
    if (targetCurrent) continue;
    const sourceFile = join(work, `source-${hash(object.sourceKey).slice(0, 16)}`);
    wrangler(["r2", "object", "get", `${sourceBucket}/${object.sourceKey}`, "--file", sourceFile, "--remote"], { capture: true });
    verifyFile(sourceFile, object);
    wrangler(["r2", "object", "put", `${targetBucket}/${object.targetKey}`, "--file", sourceFile, "--remote"]);
    wrangler(["r2", "object", "get", `${targetBucket}/${object.targetKey}`, "--file", targetFile, "--remote"], { capture: true });
    verifyFile(targetFile, { ...object, sourceKey: object.targetKey });
    copied.push(object.targetKey);
  }
  return copied;
}

function main() {
  const targetFile = arg("target");
  const manifestFile = arg("manifest");
  if (targetFile) {
    const manifest = buildManifest(readJson(targetFile));
    const out = manifestFile ?? `${targetFile}.r2.json`;
    writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, manifest: out, objects: manifest.objects.length }));
    return;
  }
  if (!manifestFile) throw new Error("--manifest or --target is required");
  const manifest = validateManifest(readJson(manifestFile));
  const sourceDir = arg("source-dir");
  const targetDir = arg("target-dir");
  if (sourceDir || targetDir) {
    if (!sourceDir || !targetDir) throw new Error("--source-dir and --target-dir are required together");
    const copied = localCopy(manifest, sourceDir, targetDir);
    console.log(JSON.stringify({ ok: true, mode: "local", copied: copied.length, objects: manifest.objects.length }));
    return;
  }
  const sourceBucket = arg("source-bucket");
  const targetBucket = arg("target-bucket");
  if (!sourceBucket || !targetBucket) throw new Error("--source-bucket and --target-bucket are required for remote copy");
  if (!flag("apply")) {
    console.log(JSON.stringify({ ok: true, mode: "dry-run", objects: manifest.objects.length, sourceBucket, targetBucket }));
    return;
  }
  const copied = remoteCopy(manifest, sourceBucket, targetBucket);
  console.log(JSON.stringify({ ok: true, mode: "remote", copied: copied.length, objects: manifest.objects.length }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`r2-copy: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
