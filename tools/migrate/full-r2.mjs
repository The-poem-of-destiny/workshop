#!/usr/bin/env node
import { spawn } from "node:child_process";
// Transfer only explicitly mapped snapshot objects into the staging asset namespaces.
import { createHash, createHmac } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = "workshop-client-staging";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
const encode = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function fail(message) {
  throw new Error(message);
}
function safeKey(key) {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    !key.startsWith("/") &&
    !key.split("/").some((part) => !part || part === "." || part === "..") &&
    !/[\u0000-\u001f\u007f\\]/.test(key)
  );
}
function within(root, path) {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function configValue(value) {
  if (/[\r\n\0]/.test(value)) fail("invalid curl configuration value");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// curl uses standard HTTP(S)_PROXY/NO_PROXY variables. Credentials are sent on
// stdin, never argv or a configuration file. Response bodies are bounded.
async function curl(options, maxBytes) {
  const config =
    options.map(([name, value]) => (value === null ? name : `${name} = ${configValue(value)}`)).join("\n") + "\n";
  return await new Promise((done, reject) => {
    const {
      CLOUDFLARE_API_TOKEN: _token,
      STAGING_IMPORT_TOKEN: _stagingToken,
      STAGING_IMPORT_R2_ACCESS_KEY_ID: _accessKey,
      STAGING_IMPORT_R2_SECRET_ACCESS_KEY: _secret,
      ...env
    } = process.env;
    const child = spawn("curl", ["-q", "--config", "-"], { env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let size = 0;
    let excessive = false;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes + 3) {
        excessive = true;
        child.kill();
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => reject(new Error("could not start curl")));
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      if (excessive) return reject(new Error("remote response exceeded expected size"));
      if (code !== 0) return reject(new Error(`curl failed (exit ${code})`));
      const result = Buffer.concat(chunks);
      const status = result.subarray(-3).toString("ascii");
      if (!/^\d{3}$/.test(status)) return reject(new Error("invalid HTTP status"));
      done({ status: Number(status), body: result.subarray(0, -3) });
    });
    child.stdin.end(config);
  });
}

async function request(account, credentials, method, key, object, file) {
  const host = `${account}.r2.cloudflarestorage.com`;
  const uri = `/${BUCKET}/${key.split("/").map(encode).join("/")}`;
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const scope = `${date.slice(0, 8)}/auto/s3/aws4_request`;
  const payloadHash = method === "PUT" ? object.sha256 : sha256("");
  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": date };
  if (method === "PUT") headers["if-none-match"] = "*";
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const canonical = `${method}\n${uri}\n\n${canonicalHeaders}\n${names.join(";")}\n${payloadHash}`;
  let signingKey = hmac(`AWS4${credentials.secret}`, date.slice(0, 8));
  for (const part of ["auto", "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = hmac(signingKey, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha256(canonical)}`).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const options = [
    ["silent", null],
    ["show-error", null],
    ["path-as-is", null],
    ["globoff", null],
    ["write-out", "%{http_code}"],
    ["url", `https://${host}${uri}`],
    ["header", `Authorization: ${authorization}`],
  ];
  for (const name of names) if (name !== "host") options.push(["header", `${name}: ${headers[name]}`]);
  if (method === "PUT") {
    options.push(["upload-file", file]);
    if (object.contentType) options.push(["header", `Content-Type: ${object.contentType}`]);
  }
  return curl(options, method === "GET" ? Math.max(object.bytes, 1024 * 1024) : 1024 * 1024);
}

export async function loadPlan(backupDir, planPath) {
  const root = await realpath(backupDir);
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  if (!manifest.buckets || !Array.isArray(plan.objects)) fail("invalid snapshot manifest or transfer plan");
  const sources = new Map();
  for (const [bucket, data] of Object.entries(manifest.buckets)) {
    if (!Array.isArray(data.objects)) fail(`invalid snapshot bucket ${bucket}`);
    for (const object of data.objects) {
      const id = JSON.stringify([bucket, object.key]);
      if (sources.has(id)) fail(`duplicate snapshot object in ${bucket}`);
      sources.set(id, object);
    }
  }
  const targets = new Set();
  const objects = [];
  for (const [index, entry] of plan.objects.entries()) {
    if (
      !safeKey(entry.sourceKey) ||
      !safeKey(entry.targetKey) ||
      !(
        entry.targetKey.startsWith("projects/") ||
        entry.targetKey.startsWith("covers/") ||
        entry.targetKey.startsWith("legacy-snapshot/")
      )
    )
      fail(`invalid source or staging asset key at objects[${index}]`);
    if (targets.has(entry.targetKey)) fail(`duplicate target key: ${entry.targetKey}`);
    targets.add(entry.targetKey);
    const source = sources.get(JSON.stringify([entry.sourceBucket, entry.sourceKey]));
    if (
      !source ||
      !Number.isSafeInteger(source.size) ||
      source.size < 0 ||
      !/^[a-f0-9]{64}$/i.test(source.sha256 ?? "") ||
      entry.bytes !== source.size ||
      typeof entry.sha256 !== "string" ||
      entry.sha256.toLowerCase() !== source.sha256.toLowerCase()
    )
      fail(`snapshot metadata mismatch at objects[${index}]`);
    if (
      !safeKey(entry.sourceBucket) ||
      entry.sourceBucket.includes("/") ||
      source.local_path !== `r2/${entry.sourceBucket}/${entry.sourceKey}` ||
      isAbsolute(source.local_path)
    )
      fail(`invalid source path at objects[${index}]`);
    const path = await realpath(resolve(root, source.local_path));
    if (!within(root, path)) fail(`source path escapes snapshot at objects[${index}]`);
    const contentType = source.http_metadata?.contentType;
    if (contentType !== undefined && (typeof contentType !== "string" || /[\r\n\0]/.test(contentType)))
      fail("invalid content type");
    objects.push({
      targetKey: entry.targetKey,
      bytes: source.size,
      sha256: source.sha256.toLowerCase(),
      path,
      contentType,
    });
  }
  return objects;
}

async function verifyLocal(object) {
  const data = await readFile(object.path);
  if (data.length !== object.bytes || sha256(data) !== object.sha256)
    fail(`source verification failed: ${object.targetKey}`);
}
async function remoteMatches(account, creds, object, allowMissing) {
  const response = await request(account, creds, "GET", object.targetKey, object);
  if (response.status === 404 && allowMissing) return false;
  if (response.status !== 200) fail(`GET ${object.targetKey} failed (HTTP ${response.status})`);
  if (response.body.length !== object.bytes || sha256(response.body) !== object.sha256)
    fail(`destination content mismatch: ${object.targetKey}`);
  return true;
}

export async function run(mode, backup, plan) {
  if (!["check", "upload", "verify"].includes(mode)) fail("mode must be check, upload or verify");
  const objects = await loadPlan(backup, plan);
  for (const object of objects) await verifyLocal(object);
  if (mode === "check") return { objects: objects.length, bytes: objects.reduce((sum, o) => sum + o.bytes, 0) };
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.STAGING_IMPORT_R2_ACCESS_KEY_ID;
  const secret = process.env.STAGING_IMPORT_R2_SECRET_ACCESS_KEY;
  if (!/^[a-f0-9]{32}$/i.test(account ?? "") || !accessKeyId || !secret || /[\r\n\0]/.test(accessKeyId + secret))
    fail("valid CLOUDFLARE_ACCOUNT_ID and dedicated staging R2 access key and secret are required");
  const creds = { accessKeyId, secret };
  let uploaded = 0;
  for (const object of objects) {
    if (mode === "verify") {
      await remoteMatches(account, creds, object, false);
      continue;
    }
    if (await remoteMatches(account, creds, object, true)) continue;
    const response = await request(account, creds, "PUT", object.targetKey, object, object.path);
    if (response.status !== 200 && response.status !== 412)
      fail(`PUT ${object.targetKey} failed (HTTP ${response.status})`);
    await remoteMatches(account, creds, object, false);
    if (response.status === 200) uploaded++;
  }
  return { objects: objects.length, uploaded, bytes: objects.reduce((sum, o) => sum + o.bytes, 0) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , mode, backup, plan, ...rest] = process.argv;
  if (!mode || !backup || !plan || rest.length) {
    console.error("Usage: node tools/migrate/full-r2.mjs <check|upload|verify> <snapshot-dir> <plan.json>");
    process.exitCode = 1;
  } else {
    run(mode, backup, plan)
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : "transfer failed");
        process.exitCode = 1;
      });
  }
}
