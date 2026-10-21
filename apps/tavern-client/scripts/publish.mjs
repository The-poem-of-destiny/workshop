#!/usr/bin/env node
/**
 * Publish a built Tavern client to a channel.
 *
 * Order: versioned object -> channel pointer -> channel record -> cache purge.
 * Never writes production unless --env production is explicit and the caller
 * has already been authorized outside this repository.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..", "..", "..");
const dist = resolve(import.meta.dirname, "..", "dist", "index.js");
const manifestPath = resolve(import.meta.dirname, "..", "dist", "manifest.json");
const args = process.argv.slice(2);
const value = name => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const env = value("env") ?? "staging";
const channel = value("channel") ?? "staging";
const dryRun = args.includes("--dry-run");

if (!["staging", "production"].includes(env)) throw new Error("--env must be staging or production");
if (!["stable", "staging"].includes(channel)) throw new Error("--channel must be stable or staging");
if (env === "production" && !args.includes("--allow-production")) throw new Error("production publish requires --allow-production");

const body = readFileSync(dist);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const sha = createHash("sha256").update(body).digest("hex");
if (sha !== manifest.revision) throw new Error("built manifest hash does not match dist/index.js");
const bucket = env === "staging" ? "workshop-client-staging" : "workshop-client-prod";
const database = env === "staging" ? "workshop-staging" : "workshop-production";
const versionedKey = `client/v/${sha}/index.js`;
const channelKey = `client/${channel}/index.js`;

function wrangler(wranglerArgs, capture = false) {
  if (dryRun) {
    console.log(`[dry-run] wrangler ${wranglerArgs.join(" ")}`);
    return "";
  }
  const result = spawnSync(
    "pnpm",
    ["--filter", "@workshop/worker", "exec", "wrangler", ...wranglerArgs],
    { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1" }, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" },
  );
  if (result.status !== 0) throw new Error(`wrangler ${wranglerArgs.join(" ")} failed`);
  return result.stdout;
}

function upload(key) {
  wrangler(["r2", "object", "put", `${bucket}/${key}`, "--file", dist, "--content-type", "text/javascript", "--remote"]);
}

upload(versionedKey);
upload(channelKey);

const query = `SELECT value FROM site_settings WHERE key = 'client_channels'`;
const output = wrangler([
  "d1", "execute", database, "--remote", "--config", "wrangler.jsonc", "--env", env,
  "--json", "--command", query,
], true);
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

console.log(JSON.stringify({ ok: true, env, channel, version: manifest.version, revision: sha, versionedKey, channelKey }));
