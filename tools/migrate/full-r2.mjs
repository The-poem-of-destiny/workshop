#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The private mode is pinned to staging; public mode transfers only generated generations.
const BUCKET = "workshop-client-staging";
const PUBLIC_FORMAT = "workshop-public-image-plan-v1";
const PUBLIC_KEY =
  /^covers\/(?:(gallery|banner)\/)?[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const UPLOAD_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const COVER_MIME = new Set([...UPLOAD_MIME, "image/gif", "image/avif"]);
const PUBLIC_CACHE = "public, max-age=0, must-revalidate";
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
async function curl(options, maxBytes, readHeaders) {
  const config =
    options.map(([name, value]) => (value === null ? name : `${name} = ${configValue(value)}`)).join("\n") + "\n";
  return await new Promise((done, reject) => {
    const {
      CLOUDFLARE_API_TOKEN: _token,
      STAGING_IMPORT_TOKEN: _stagingToken,
      STAGING_IMPORT_R2_ACCESS_KEY_ID: _accessKey,
      STAGING_IMPORT_R2_SECRET_ACCESS_KEY: _secret,
      PUBLIC_IMAGE_IMPORT_R2_ACCESS_KEY_ID: _publicAccessKey,
      PUBLIC_IMAGE_IMPORT_R2_SECRET_ACCESS_KEY: _publicSecret,
      ...env
    } = process.env;
    const child = spawn("curl", ["-q", "--config", "-"], { env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let size = 0;
    let excessive = false;
    const metadata = [];
    let metadataSize = 0;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        excessive = true;
        child.kill();
      } else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      metadataSize += chunk.length;
      if (metadataSize > 32 * 1024) {
        excessive = true;
        child.kill();
      } else metadata.push(chunk);
    });
    child.on("error", () => reject(new Error("could not start curl")));
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      if (excessive) return reject(new Error("remote response exceeded expected size"));
      if (code !== 0) return reject(new Error(`curl failed (exit ${code})`));
      const result = Buffer.concat(metadata).toString("utf8");
      const status = readHeaders ? result.slice(0, 3) : result;
      if (!/^\d{3}$/.test(status)) return reject(new Error("invalid HTTP response status"));
      try {
        done({
          status: Number(status),
          headers: readHeaders ? JSON.parse(result.slice(3)) : undefined,
          body: Buffer.concat(chunks, size),
        });
      } catch {
        reject(new Error("invalid HTTP response headers (curl 7.84+ required for public verification)"));
      }
    });
    child.stdin.end(config);
  });
}

async function request(account, bucket, credentials, method, key, object, file) {
  const host = `${account}.r2.cloudflarestorage.com`;
  const uri = `/${bucket}/${key.split("/").map(encode).join("/")}`;
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const scope = `${date.slice(0, 8)}/auto/s3/aws4_request`;
  const payloadHash = method === "PUT" ? object.sha256 : sha256("");
  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": date };
  const readHeaders = method === "GET" && !!object.cacheControl;
  if (method === "PUT") {
    headers["if-none-match"] = "*";
    if (object.cacheControl) headers["cache-control"] = object.cacheControl;
    if (object.contentType) headers["content-type"] = object.contentType;
  }
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const canonical = `${method}\n${uri}\n\n${canonicalHeaders}\n${names.join(";")}\n${payloadHash}`;
  let signingKey = hmac(`AWS4${credentials.secret}`, date.slice(0, 8));
  for (const part of ["auto", "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = hmac(signingKey, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha256(canonical)}`).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const options = [
    ["silent", null],
    ["path-as-is", null],
    ["globoff", null],
    ["write-out", readHeaders ? "%{stderr}%{http_code}%{header_json}" : "%{stderr}%{http_code}"],
    ["url", `https://${host}${uri}`],
    ["header", `Authorization: ${authorization}`],
  ];
  for (const name of names) if (name !== "host") options.push(["header", `${name}: ${headers[name]}`]);
  if (method === "PUT") options.push(["upload-file", file]);
  return curl(options, method === "GET" ? Math.max(object.bytes, 1024 * 1024) : 1024 * 1024, readHeaders);
}

export async function loadPlan(backupDir, planPath) {
  return loadObjects(backupDir, JSON.parse(await readFile(planPath, "utf8")), false);
}

function validTransferKeys(entry, privateBucket, publicTarget) {
  if (!safeKey(entry.sourceKey) || !safeKey(entry.targetKey)) return false;
  if (publicTarget) {
    const key = PUBLIC_KEY.exec(entry.targetKey);
    return key !== null && (key[1] ?? "cover") === entry.kind && entry.sourceBucket === privateBucket;
  }
  return (
    entry.targetKey.startsWith("projects/") ||
    entry.targetKey.startsWith("covers/") ||
    entry.targetKey.startsWith("legacy-snapshot/")
  );
}

function sourceObjects(buckets) {
  const sources = new Map();
  for (const [bucket, data] of Object.entries(buckets)) {
    if (!Array.isArray(data.objects)) fail(`invalid snapshot bucket ${bucket}`);
    for (const object of data.objects) {
      const id = JSON.stringify([bucket, object.key]);
      if (sources.has(id)) fail(`duplicate snapshot object in ${bucket}`);
      sources.set(id, object);
    }
  }
  return sources;
}

async function loadObjects(backupDir, plan, publicTarget) {
  const root = await realpath(backupDir);
  const raw = await readFile(resolve(root, "manifest.json"));
  const manifest = JSON.parse(raw);
  if (!manifest.buckets || !Array.isArray(plan.objects)) fail("invalid snapshot manifest or transfer plan");
  if (publicTarget && (plan.format !== PUBLIC_FORMAT || sha256(raw) !== plan.manifestSha256))
    fail("public transfer manifest differs from the prepared snapshot");
  const sources = sourceObjects(manifest.buckets);
  const targets = new Set();
  const objects = [];
  for (const [index, entry] of plan.objects.entries()) {
    if (!validTransferKeys(entry, plan.privateBucket, publicTarget))
      fail(`invalid source or destination asset key at objects[${index}]`);
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
    if (
      publicTarget &&
      (!(entry.kind === "cover" ? COVER_MIME : UPLOAD_MIME).has(entry.contentType) ||
        (entry.kind !== "gallery" && contentType !== entry.contentType))
    )
      fail(`public image MIME mismatch at objects[${index}]`);
    objects.push({
      targetKey: entry.targetKey,
      bytes: source.size,
      sha256: source.sha256.toLowerCase(),
      path,
      contentType: publicTarget ? entry.contentType : contentType,
      cacheControl: publicTarget ? PUBLIC_CACHE : undefined,
    });
  }
  return objects;
}

async function verifyLocal(object) {
  const data = await readFile(object.path);
  if (data.length !== object.bytes || sha256(data) !== object.sha256)
    fail(`source verification failed: ${object.targetKey}`);
  return data;
}
async function remoteMatches(account, bucket, creds, object, allowMissing) {
  const response = await request(account, bucket, creds, "GET", object.targetKey, object);
  if (response.status === 404 && allowMissing) return false;
  if (response.status !== 200) fail(`GET ${object.targetKey} failed (HTTP ${response.status})`);
  if (response.body.length !== object.bytes || sha256(response.body) !== object.sha256)
    fail(`destination content mismatch: ${object.targetKey}`);
  if (object.cacheControl) {
    const { etag, "cache-control": cacheControl, "content-type": contentType } = response.headers;
    const tag = Array.isArray(etag) && etag.length === 1 && /^"([\x21\x23-\x7e]+)"$/.exec(etag[0]);
    if (
      !Array.isArray(cacheControl) ||
      cacheControl.length !== 1 ||
      cacheControl[0] !== object.cacheControl ||
      !Array.isArray(contentType) ||
      contentType.length !== 1 ||
      contentType[0] !== object.contentType ||
      !tag
    )
      fail(`destination metadata mismatch: ${object.targetKey}`);
    return tag[1];
  }
  return true;
}

async function uploadObject(account, bucket, creds, object) {
  if (!object.cacheControl) return request(account, bucket, creds, "PUT", object.targetKey, object, object.path);
  const directory = await mkdtemp(resolve(tmpdir(), "workshop-public-image-"));
  try {
    // Publish the exact bytes we verified, even if the downloaded file changes before curl opens its input.
    const path = resolve(directory, "verified-image");
    await writeFile(path, await verifyLocal(object), { mode: 0o600, flag: "wx" });
    return await request(account, bucket, creds, "PUT", object.targetKey, object, path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function run(mode, backup, plan) {
  if (!["check", "upload", "verify"].includes(mode)) fail("mode must be check, upload or verify");
  const objects = await loadPlan(backup, plan);
  for (const object of objects) await verifyLocal(object);
  if (mode === "check") return { objects: objects.length, bytes: objects.reduce((sum, o) => sum + o.bytes, 0) };
  return transfer(mode, objects, process.env.CLOUDFLARE_ACCOUNT_ID, BUCKET, false);
}

async function runPublic(mode, backup, plan) {
  const { account, publicBucket, privateBucket } = plan;
  if (
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(publicBucket ?? "") ||
    publicBucket === privateBucket ||
    publicBucket.startsWith("workshop-client-")
  )
    fail("invalid or non-isolated public destination bucket");
  const objects = await loadObjects(backup, plan, true);
  for (const object of objects) await verifyLocal(object);
  if (mode === "check") return { objects: objects.length, bytes: objects.reduce((sum, o) => sum + o.bytes, 0) };
  return transfer(mode, objects, account, publicBucket, true);
}

async function transfer(mode, objects, account, bucket, publicTarget) {
  const prefix = publicTarget ? "PUBLIC_IMAGE_IMPORT_R2" : "STAGING_IMPORT_R2";
  const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`];
  const secret = process.env[`${prefix}_SECRET_ACCESS_KEY`];
  if (!/^[a-f0-9]{32}$/i.test(account ?? "") || !accessKeyId || !secret || /[\r\n\0]/.test(accessKeyId + secret))
    fail(`valid target account and dedicated ${prefix} access key and secret are required`);
  const creds = { accessKeyId, secret };
  let uploaded = 0;
  const etags = {};
  for (const object of objects) {
    if (mode === "verify") {
      const matched = await remoteMatches(account, bucket, creds, object, false);
      if (publicTarget) etags[object.targetKey] = matched;
      continue;
    }
    if (await remoteMatches(account, bucket, creds, object, true)) continue;
    const response = await uploadObject(account, bucket, creds, object);
    if (response.status !== 200 && response.status !== 412)
      fail(`PUT ${object.targetKey} failed (HTTP ${response.status})`);
    await remoteMatches(account, bucket, creds, object, false);
    if (response.status === 200) uploaded++;
  }
  return {
    objects: objects.length,
    uploaded,
    bytes: objects.reduce((sum, o) => sum + o.bytes, 0),
    ...(publicTarget && mode === "verify" ? { etags } : {}),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , mode, backup, plan, ...rest] = process.argv;
  if (["public-check", "public-upload", "public-verify"].includes(mode) && backup && !plan) {
    new Promise((done, reject) => {
      const chunks = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => done(Buffer.concat(chunks)));
      process.stdin.on("error", reject);
    })
      .then((raw) => runPublic(mode.slice(7), backup, JSON.parse(raw)))
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error) => {
        console.error(error instanceof Error && !error.code ? error.message : "transfer failed");
        process.exitCode = 1;
      });
  } else if (!mode || !backup || !plan || rest.length) {
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
