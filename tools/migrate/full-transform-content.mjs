// Offline helper for full-transform.py. Reads one JSON array from stdin and
// returns validation results in the same order; paths must be backup files.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractProjectEntries, validateProjectContentText } from "../../packages/domain/src/project-content.ts";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const input = JSON.parse(
  await new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  }),
);
const result = [];
for (const asset of input) {
  let stage = "integrity";
  try {
    const bytes = await readFile(asset.path);
    if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256)
      throw new Error("backup object hash or size mismatch");
    if (asset.kind === "cover") {
      result.push({ id: asset.id, entries: [] });
      continue;
    }
    const text = bytes.toString("utf8");
    stage = "content";
    if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("content is not UTF-8");
    const validation = validateProjectContentText(text, asset.kind);
    if (!validation.valid) throw new Error(validation.error);
    const entries = extractProjectEntries(JSON.parse(text), asset.kind).map(({ entry, entryKey }) => {
      const content =
        typeof entry.content === "string"
          ? entry.content
          : typeof entry.replaceString === "string"
            ? entry.replaceString
            : "";
      return {
        kind: asset.kind,
        entry_key: entryKey,
        name:
          [entry.name, entry.comment, entry.scriptName].find((value) => typeof value === "string" && value.trim()) ||
          entryKey,
        content_hash: hash(content),
        content_length: Array.from(content).length,
      };
    });
    if (validation.entryCount !== entries.length) throw new Error("content index count mismatch");
    if (new Set(entries.map((entry) => entry.entry_key)).size !== entries.length)
      throw new Error("duplicate entry keys");
    result.push({ id: asset.id, entries });
  } catch (error) {
    result.push({ id: asset.id, error: error instanceof Error ? error.message : String(error), stage });
  }
}
process.stdout.write(JSON.stringify(result));
