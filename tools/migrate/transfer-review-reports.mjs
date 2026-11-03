#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureR2Object, r2ImportCredentials } from "./import-r2.mjs";

const quote = (value) => `'${value.replaceAll("'", "''")}'`;

/** Verify every exported byte before network writes; receipts follow remote byte verification. */
export async function transferReviewReports(directory, receiptPath, options = {}) {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(resolve(root, "review-report-manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.reports)) throw new Error("Invalid report manifest");
  const objects = new Map();
  for (const row of manifest.reports) {
    if (
      !["submissions", "submission_check_runs"].includes(row.source) ||
      typeof row.sourceId !== "string" ||
      typeof row.submissionId !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(row.submissionId) ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      row.key !== `reports/${row.submissionId}/${row.sha256}.json` ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 0
    )
      throw new Error("Invalid report manifest record");
    const body = await readFile(resolve(root, row.key));
    if (body.length !== row.bytes || createHash("sha256").update(body).digest("hex") !== row.sha256)
      throw new Error(`Report bytes differ: ${row.key}`);
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    objects.set(row.key, { ...row, body });
  }
  if (
    manifest.objectCount !== objects.size ||
    manifest.totalBytes !== [...objects.values()].reduce((sum, row) => sum + row.bytes, 0)
  )
    throw new Error("Report manifest totals differ");
  if (options.checkOnly) return { objects: objects.size, reports: manifest.reports.length };
  const credentials = options.credentials ?? r2ImportCredentials(process.env);
  const accountId = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  for (const row of objects.values()) {
    await ensureR2Object({
      accountId,
      bucket: "workshop-client-staging",
      key: row.key,
      body: row.body,
      sha256: row.sha256,
      bytes: row.bytes,
      credentials,
      endpoint: options.endpoint,
    });
  }
  const sql = [
    "BEGIN;",
    "CREATE TABLE IF NOT EXISTS review_report_transfer_receipts (source TEXT NOT NULL, source_id TEXT NOT NULL, submission_id TEXT NOT NULL, report_hash TEXT NOT NULL, PRIMARY KEY(source,source_id));",
  ];
  for (const row of manifest.reports)
    sql.push(
      `INSERT INTO review_report_transfer_receipts VALUES (${[row.source, row.sourceId, row.submissionId, row.sha256].map(quote).join(",")}) ON CONFLICT(source,source_id) DO UPDATE SET submission_id=excluded.submission_id,report_hash=excluded.report_hash;`,
    );
  sql.push("COMMIT;", "");
  await writeFile(receiptPath, sql.join("\n"));
  return { objects: objects.size, reports: manifest.reports.length, receiptPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, directory, receiptPath, ...extra] = process.argv.slice(2);
  if (!["check", "upload"].includes(mode) || !directory || extra.length || (mode === "upload" && !receiptPath))
    throw new Error(
      "Usage: node tools/migrate/transfer-review-reports.mjs <check|upload> <export-directory> [receipt.sql]",
    );
  console.log(JSON.stringify(await transferReviewReports(directory, receiptPath, { checkOnly: mode === "check" })));
}
