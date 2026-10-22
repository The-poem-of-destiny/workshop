#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Publish a built Tavern client to a channel.
 *
 * Order: versioned object -> channel pointer -> channel record -> cache purge.
 * Never writes production unless --env production is explicit and the caller
 * has already been authorized outside this repository.
 *
 * Objects are written through the R2 S3 endpoint (SigV4) rather than Wrangler's
 * REST helper: bucket-scoped R2 credentials ("Object Read & Write") only apply
 * to the S3 API, so the S3 path keeps CI credentials least-privilege. The S3
 * access key is the API token id and the secret is the SHA-256 of its value.
 * D1 bookkeeping still uses Wrangler.
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");
const dist = resolve(import.meta.dirname, "..", "dist", "index.js");
const manifestPath = resolve(import.meta.dirname, "..", "dist", "manifest.json");
const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const env = value("env") ?? "staging";
const channel = value("channel") ?? "staging";
const dryRun = args.includes("--dry-run");

if (!["staging", "production"].includes(env)) throw new Error("--env must be staging or production");
if (!["stable", "staging"].includes(channel)) throw new Error("--channel must be stable or staging");
if (env === "production" && !args.includes("--allow-production"))
  throw new Error("production publish requires --allow-production");

const body = readFileSync(dist);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const sha = createHash("sha256").update(body).digest("hex");
if (sha !== manifest.revision) throw new Error("built manifest hash does not match dist/index.js");
const bucket = env === "staging" ? "workshop-client-staging" : "workshop-client-prod";
const database = env === "staging" ? "workshop-staging" : "workshop-prod";
const versionedKey = `client/v/${sha}/index.js`;
const channelKey = `client/${channel}/index.js`;

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

function wrangler(wranglerArgs, capture = false) {
  if (dryRun) {
    console.log(`[dry-run] wrangler ${wranglerArgs.join(" ")}`);
    return "";
  }
  const result = spawnSync("pnpm", ["--filter", "@workshop/worker", "exec", "wrangler", ...wranglerArgs], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) throw new Error(`wrangler ${wranglerArgs.join(" ")} failed`);
  return result.stdout;
}

const hex = (buffer) => buffer.toString("hex");
const sha256Hex = (input) => hex(createHash("sha256").update(input).digest());
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

async function s3Credentials() {
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required");
  if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN is required");
  if (dryRun) return { accessKeyId: "dry-run", secretAccessKey: "dry-run" };
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  const payload = await response.json();
  if (!response.ok || !payload?.success || typeof payload.result?.id !== "string")
    throw new Error(`token verification failed: ${response.status}`);
  return { accessKeyId: payload.result.id, secretAccessKey: sha256Hex(apiToken) };
}

function signedPut({ accessKeyId, secretAccessKey }, key) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;
  let signingKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  signingKey = hmac(signingKey, "auto");
  signingKey = hmac(signingKey, "s3");
  signingKey = hmac(signingKey, "aws4_request");
  const signature = hex(hmac(signingKey, stringToSign));
  return fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "content-type": "text/javascript",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body,
  });
}

async function upload(key) {
  if (dryRun) {
    console.log(`[dry-run] s3 put ${bucket}/${key}`);
    return;
  }
  const response = await signedPut(credentials, key);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`R2 upload failed for ${key}: ${response.status} ${detail}`);
  }
}

const credentials = await s3Credentials();
await upload(versionedKey);

const query = `SELECT value FROM site_settings WHERE key = 'client_channels'`;
const output = wrangler(
  ["d1", "execute", database, "--remote", "--config", "wrangler.jsonc", "--env", env, "--json", "--command", query],
  true,
);
let channels = {};
try {
  const parsed = JSON.parse(output);
  const raw = parsed?.[0]?.results?.[0]?.value;
  if (typeof raw === "string") channels = JSON.parse(raw);
} catch {
  channels = {};
}
channels[channel] = { revision: sha, version: manifest.version, publishedAt: new Date().toISOString() };
const escaped = JSON.stringify(channels).replaceAll("'", "''");
const sql = `INSERT INTO site_settings (key, value, updated_at) VALUES ('client_channels', '${escaped}', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`;
wrangler(["d1", "execute", database, "--remote", "--config", "wrangler.jsonc", "--env", env, "--command", sql]);

// The channel pointer is written only after the version object and its D1
// record exist, so a failed publish cannot point at a missing artifact.
await upload(channelKey);

async function purgeChannel() {
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const publicUrl = process.env.WORKSHOP_PUBLIC_URL;
  if (!zone || !token || !publicUrl) {
    console.log(
      "[purge skipped] set CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN and WORKSHOP_PUBLIC_URL to purge the channel",
    );
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] purge client:${channel} at ${publicUrl}`);
    return;
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ tags: [`client:${channel}`] }),
  });
  if (!response.ok) throw new Error(`cache purge failed: ${response.status} ${await response.text()}`);
}
await purgeChannel();

console.log(
  JSON.stringify({ ok: true, env, channel, version: manifest.version, revision: sha, versionedKey, channelKey }),
);
