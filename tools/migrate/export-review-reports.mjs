#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

/** Export exact legacy report bytes before destructive schema migration. No network access. */
export async function exportReviewReports(databasePath, outputDirectory) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const records = [];
  const objects = new Map();
  const failures = [];
  function collect(source, sourceId, submissionId, report, expectedHash) {
    if (report === null && expectedHash === null) return;
    if (typeof report !== "string" || typeof expectedHash !== "string") {
      failures.push(`${source}:${sourceId}: incomplete report/hash pair`);
      return;
    }
    try {
      JSON.parse(report);
    } catch {
      failures.push(`${source}:${sourceId}: invalid report JSON`);
      return;
    }
    const hash = createHash("sha256").update(report, "utf8").digest("hex");
    if (hash !== expectedHash) {
      failures.push(`${source}:${sourceId}: report SHA-256 mismatch`);
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(submissionId)) {
      failures.push(`${source}:${sourceId}: unsafe submission identifier`);
      return;
    }
    const key = `reports/${submissionId}/${hash}.json`;
    const previous = objects.get(key);
    if (previous !== undefined && previous !== report) throw new Error(`Report key collision: ${key}`);
    objects.set(key, report);
    records.push({ source, sourceId, submissionId, key, sha256: hash, bytes: Buffer.byteLength(report) });
  }
  try {
    db.exec("BEGIN");
    for (const row of db.prepare("SELECT id,check_report,check_report_hash FROM submissions ORDER BY id").all()) {
      collect("submissions", row.id, row.id, row.check_report, row.check_report_hash);
    }
    for (const row of db
      .prepare("SELECT id,submission_id,report,report_hash FROM submission_check_runs ORDER BY id")
      .all()) {
      collect("submission_check_runs", row.id, row.submission_id, row.report, row.report_hash);
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  if (failures.length) throw new Error(`Report export refused:\n${failures.join("\n")}`);
  for (const [key, report] of objects) {
    const target = path.join(outputDirectory, key);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, report, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stored = await readFile(target);
    if (!stored.equals(Buffer.from(report, "utf8"))) throw new Error(`Existing report object differs: ${key}`);
  }
  const manifest = {
    schemaVersion: 1,
    reports: records,
    objectCount: objects.size,
    totalBytes: [...objects.values()].reduce((sum, report) => sum + Buffer.byteLength(report), 0),
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "review-report-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [databasePath, outputDirectory, ...extra] = process.argv.slice(2);
  if (!databasePath || !outputDirectory || extra.length) {
    throw new Error("Usage: node tools/migrate/export-review-reports.mjs <legacy.sqlite> <output-directory>");
  }
  const manifest = await exportReviewReports(databasePath, outputDirectory);
  console.log(
    JSON.stringify({ reports: manifest.reports.length, objects: manifest.objectCount, bytes: manifest.totalBytes }),
  );
}
