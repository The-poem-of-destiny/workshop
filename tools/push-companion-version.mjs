#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export function parseCompanionPushArgs(args) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!["--origin", "--script", "--version", "--name", "--url"].includes(name) || !args[i + 1] || options.has(name)) {
      throw new Error(
        "Usage: node tools/push-companion-version.mjs --script <slug> --version <label> --name <display-name> --url <https-url> [--origin <origin>]. Set WORKSHOP_SESSION_TOKEN to an owner session; no .env is read.",
      );
    }
    options.set(name, args[i + 1]);
  }
  const origin = new URL(options.get("--origin") ?? "http://localhost:8787");
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !(
      origin.protocol === "https:" ||
      (origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    )
  ) {
    throw new Error("Origin must be HTTPS or local HTTP, with no path, credentials, query or fragment");
  }
  const scriptId = options.get("--script") ?? "";
  const version = options.get("--version") ?? "";
  const displayName = (options.get("--name") ?? "").trim();
  const downloadUrl = options.get("--url") ?? "";
  if (
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(scriptId) ||
    !/^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(version) ||
    !displayName ||
    displayName.length > 120
  ) {
    throw new Error("Invalid script, version or display name");
  }
  const download = new URL(downloadUrl);
  if (download.protocol !== "https:" || download.username || download.password || downloadUrl.length > 2048) {
    throw new Error("Download URL must be credential-free HTTPS");
  }
  return { origin: origin.origin, scriptId, version, input: { displayName, downloadUrl } };
}

export async function pushCompanionVersion(options, token, fetcher = fetch) {
  if (!token || /\s/.test(token)) throw new Error("WORKSHOP_SESSION_TOKEN must contain an owner session token");
  const path = `${options.origin}/api/v1/companion-scripts/${encodeURIComponent(options.scriptId)}/versions/${encodeURIComponent(options.version)}`;
  const response = await fetcher(path, {
    method: "PUT",
    redirect: "error",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(options.input),
  });
  if (!response.ok) throw new Error(`Companion push rejected (HTTP ${response.status})`);
  const published = await response.json();
  const read = await fetcher(path, { redirect: "error" });
  if (!read.ok) throw new Error(`Companion exact-version read failed (HTTP ${read.status})`);
  const record = await read.json();
  if (
    record.scriptId !== options.scriptId ||
    record.version !== options.version ||
    record.displayName !== options.input.displayName ||
    record.downloadUrl !== options.input.downloadUrl ||
    record.releaseId !== published.releaseId ||
    record.publishedAt !== published.publishedAt
  ) {
    throw new Error("Companion exact-version read differs from published record");
  }
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const record = await pushCompanionVersion(
      parseCompanionPushArgs(process.argv.slice(2)),
      process.env.WORKSHOP_SESSION_TOKEN,
    );
    console.log(JSON.stringify(record, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Companion push failed");
    process.exitCode = 1;
  }
}
