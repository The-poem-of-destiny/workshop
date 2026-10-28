import { createHash, createHmac } from "node:crypto";

// Cloudflare R2 S3 extensions (updated 2026-10-14) explicitly guarantee atomic
// PutObject If-None-Match:* and 412 for competing writes. Wrangler/REST upload
// does not provide that contract. Never replace this with an unconditional PUT.
// https://developers.cloudflare.com/r2/api/s3/extensions/#conditional-operations-in-putobject
export function r2ImportCredentials(env) {
  const accessKeyId = env.STAGING_IMPORT_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.STAGING_IMPORT_R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey || !/^[A-Za-z0-9]+$/.test(accessKeyId)) {
    throw new Error("Apply requires dedicated STAGING_IMPORT_R2_ACCESS_KEY_ID and STAGING_IMPORT_R2_SECRET_ACCESS_KEY");
  }
  return { accessKeyId, secretAccessKey };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function objectUrl(accountId, bucket, key, endpoint) {
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error("Invalid R2 account ID");
  if (!/^[a-z0-9-]+$/.test(bucket)) throw new Error("Invalid R2 bucket");
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid R2 object key");
  }
  const origin = endpoint ? new URL(endpoint) : new URL(`https://${accountId}.r2.cloudflarestorage.com`);
  // Local protocol tests may substitute an isolated HTTP server, never a remote
  // credential sink. The CLI never accepts an endpoint override.
  if (endpoint && (origin.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(origin.hostname))) {
    throw new Error("R2 test endpoint must be loopback HTTP");
  }
  const encode = (segment) =>
    encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return new URL(`/${[bucket, ...segments].map(encode).join("/")}`, origin);
}

function signedHeaders(method, url, bodyHash, credentials) {
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = date.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const headers = { host: url.host, "x-amz-content-sha256": bodyHash, "x-amz-date": date };
  if (method === "PUT") headers["if-none-match"] = "*";
  const names = Object.keys(headers).sort();
  const signed = names.join(";");
  const canonical = [
    method,
    url.pathname,
    "",
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    signed,
    bodyHash,
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", date, scope, digest(canonical)].join("\n");
  const dayKey = hmac(`AWS4${credentials.secretAccessKey}`, day);
  const signingKey = hmac(hmac(hmac(dayKey, "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  return headers;
}

async function request(method, url, body, credentials) {
  try {
    return await fetch(url, {
      method,
      headers: signedHeaders(method, url, digest(body ?? ""), credentials),
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    // Do not retain transport causes, request headers, signed URLs, or server
    // error bodies: these can contain credentials or reflected Authorization.
    throw new Error(`R2 ${method} transport failed`);
  }
}

async function matchesRemote(url, credentials, expected) {
  const response = await request("GET", url, undefined, credentials);
  if (response.status !== 200) {
    await response.body?.cancel();
    if (response.status === 404) return false;
    throw new Error(`R2 GET failed (HTTP ${response.status})`);
  }
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > expected.bytes) throw new Error("mismatch");
      hash.update(chunk);
    }
  } catch {
    throw new Error("R2 existing object mismatch or unreadable body; refusing write");
  }
  if (bytes !== expected.bytes || hash.digest("hex") !== expected.sha256) {
    throw new Error("R2 existing object mismatch; refusing write");
  }
  return true;
}

export async function ensureR2Object({ accountId, bucket, key, body, sha256, bytes, credentials, endpoint }) {
  if (body.length !== bytes || digest(body) !== sha256) throw new Error("R2 packaged object mismatch");
  const url = objectUrl(accountId, bucket, key, endpoint);
  const expected = { sha256, bytes };
  if (await matchesRemote(url, credentials, expected)) return { key, sha256, bytes, disposition: "reused" };
  const response = await request("PUT", url, body, credentials);
  await response.body?.cancel();
  if (!response.ok && response.status !== 412) throw new Error(`R2 conditional PUT failed (HTTP ${response.status})`);
  // A 412 means another writer won. It is safe to reuse only after checking
  // actual bytes, never ETag or caller-controlled metadata. No overwrite retry.
  if (!(await matchesRemote(url, credentials, expected))) throw new Error("R2 object missing after conditional PUT");
  return { key, sha256, bytes, disposition: response.status === 412 ? "reused" : "created" };
}
