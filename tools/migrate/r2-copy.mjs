#!/usr/bin/env node
/** Build or rehearse a local, SHA-verified asset copy manifest. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hash = (value) => createHash("sha256").update(value).digest("hex");

function arg(name, fallback) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function validateManifest(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.objects))
    throw new Error("manifest.objects must be an array");
  const targets = new Set();
  for (const [index, object] of value.objects.entries()) {
    if (typeof object.sourceKey !== "string" || !object.sourceKey)
      throw new Error(`objects[${index}].sourceKey is required`);
    if (typeof object.targetKey !== "string" || !object.targetKey)
      throw new Error(`objects[${index}].targetKey is required`);
    if (!/^[a-f0-9]{64}$/i.test(String(object.sha256 ?? "")))
      throw new Error(`objects[${index}].sha256 must be 64 hex characters`);
    if (!Number.isInteger(object.bytes) || object.bytes < 0)
      throw new Error(`objects[${index}].bytes must be a non-negative integer`);
    if (targets.has(object.targetKey)) throw new Error(`duplicate targetKey: ${object.targetKey}`);
    targets.add(object.targetKey);
  }
  return value;
}

export function buildManifest(target) {
  const objects = new Map();
  for (const asset of target?.tables?.assets ?? []) {
    const object = {
      sourceKey: target?.meta?.assetSources?.[asset.id],
      targetKey: asset.r2_key,
      sha256: asset.sha256,
      bytes: asset.bytes,
    };
    const existing = objects.get(object.targetKey);
    if (existing) {
      if (existing.sha256 !== object.sha256 || existing.bytes !== object.bytes)
        throw new Error(`conflicting shared object: ${object.targetKey}`);
      continue;
    }
    objects.set(object.targetKey, object);
  }
  return validateManifest({
    format: "workshop-local-asset-manifest-v1",
    objects: [...objects.values()].sort((left, right) => left.targetKey.localeCompare(right.targetKey)),
  });
}

function verifyFile(file, object) {
  const bytes = readFileSync(file);
  if (bytes.byteLength !== object.bytes)
    throw new Error(`${object.sourceKey}: byte mismatch ${bytes.byteLength} != ${object.bytes}`);
  const actual = hash(bytes);
  if (actual !== object.sha256.toLowerCase()) throw new Error(`${object.sourceKey}: sha256 mismatch ${actual}`);
}

export function localCopy(manifest, sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const copied = [];
  for (const object of validateManifest(manifest).objects) {
    const source = join(resolve(sourceDir), object.sourceKey);
    const target = join(resolve(targetDir), object.targetKey);
    if (!existsSync(source)) throw new Error(`missing source asset: ${object.sourceKey}`);
    verifyFile(source, object);
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      const bytes = readFileSync(target);
      if (bytes.byteLength === object.bytes && hash(bytes) === object.sha256.toLowerCase()) continue;
    }
    writeFileSync(target, readFileSync(source));
    verifyFile(target, { ...object, sourceKey: object.targetKey });
    copied.push(object.targetKey);
  }
  return copied;
}

function main() {
  const targetFile = arg("target");
  const manifestFile = arg("manifest");
  if (targetFile) {
    const manifest = buildManifest(JSON.parse(readFileSync(targetFile, "utf8")));
    const output = manifestFile ?? `${targetFile}.assets.json`;
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, manifest: output, objects: manifest.objects.length }));
    return;
  }
  if (!manifestFile) throw new Error("--manifest or --target is required");
  const sourceDir = arg("source-dir");
  const targetDir = arg("target-dir");
  if (!sourceDir || !targetDir) throw new Error("--source-dir and --target-dir are required for local copy");
  const manifest = validateManifest(JSON.parse(readFileSync(manifestFile, "utf8")));
  const copied = localCopy(manifest, sourceDir, targetDir);
  console.log(JSON.stringify({ ok: true, mode: "local", copied: copied.length, objects: manifest.objects.length }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`r2-copy: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
