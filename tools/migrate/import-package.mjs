/** Freeze verified package inputs before any remote preflight or mutation. */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { migrationSql } from "./lib.mjs";
import { buildManifest, validateManifest } from "./r2-copy.mjs";
import { verify } from "./validation.mjs";

function assetPath(root, key) {
  const file = path.resolve(root, key);
  const relative = path.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error(`asset key escapes package directory: ${key}`);
  return file;
}

export function sealImportPackage({ packageDir, isolatedCwd }) {
  // Parse once. No later operation reloads target/manifest from the mutable package.
  const target = JSON.parse(readFileSync(path.join(packageDir, "target.json"), "utf8"));
  const report = verify(target);
  if (!report.ok) throw new Error(`target failed verification: ${JSON.stringify(report.mismatches.slice(0, 5))}`);
  const manifest = validateManifest(JSON.parse(readFileSync(path.join(packageDir, "target.json.assets.json"), "utf8")));
  if (JSON.stringify(manifest) !== JSON.stringify(buildManifest(target)))
    throw new Error("asset manifest does not match target");
  const sql = Buffer.from(migrationSql(target), "utf8");
  if (!readFileSync(path.join(packageDir, "import.sql")).equals(sql))
    throw new Error("package import.sql does not exactly match verified target additive SQL");

  const sealedDir = mkdtempSync(path.join(isolatedCwd, "verified-package-"));
  const sourceDir = path.join(sealedDir, "r2-target");
  const sqlPath = path.join(sealedDir, "import.sql");
  try {
    mkdirSync(sourceDir);
    for (const object of manifest.objects) {
      // Read once, verify these bytes, and upload only their private copy. Changes
      // to the original package during remote I/O cannot change approved inputs.
      const bytes = readFileSync(assetPath(path.join(packageDir, "r2-target"), object.targetKey));
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== object.bytes || digest !== object.sha256)
        throw new Error(`packaged asset mismatch: ${object.targetKey}`);
      const destination = assetPath(sourceDir, object.targetKey);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: "wx", mode: 0o400 });
    }
    writeFileSync(sqlPath, sql, { flag: "wx", mode: 0o400 });
    return { target, manifest, sourceDir, sqlPath };
  } catch (error) {
    rmSync(sealedDir, { recursive: true, force: true });
    throw error;
  }
}
