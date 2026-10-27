import { extractProjectEntries, validateProjectContentText } from "../../packages/domain/src/project-content.ts";
import { generatedId, hash, SHA256, text } from "./values.mjs";

function decodeAsset(row) {
  const encoded = row.content_base64;
  if (typeof encoded !== "string" || encoded.length === 0) return { ok: false, reason: "missing_content_base64" };
  const normalized = encoded.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0)
    return { ok: false, reason: "invalid_content_base64" };
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64") !== normalized) return { ok: false, reason: "invalid_content_base64" };
  const sha256 = text(row.sha256).toLowerCase();
  if (!SHA256.test(sha256)) return { ok: false, reason: "invalid_sha256" };
  if (hash(bytes) !== sha256) return { ok: false, reason: "sha256_mismatch" };
  if (!Number.isInteger(row.bytes) || row.bytes !== bytes.byteLength || row.bytes < 0)
    return { ok: false, reason: "byte_count_mismatch" };
  return { ok: true, bytes, sha256 };
}

function indexedEntries(raw, kind) {
  return extractProjectEntries(raw, kind).map(({ entry, entryKey }) => {
    const entry_key = entryKey;
    const content =
      typeof entry.content === "string"
        ? entry.content
        : typeof entry.replaceString === "string"
          ? entry.replaceString
          : "";
    const name =
      [entry.name, entry.comment, entry.scriptName].find((value) => typeof value === "string" && value.trim()) ||
      entry_key;
    return {
      kind,
      entry_key,
      name,
      content_hash: hash(content),
      content_length: Array.from(content).length,
    };
  });
}

function validateContentAsset(asset) {
  const decoded = decodeAsset(asset);
  if (!decoded.ok) return decoded;
  const content = decoded.bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(decoded.bytes)) return { ok: false, reason: "content_not_utf8" };
  try {
    const validation = validateProjectContentText(content, asset.kind);
    if (!validation.valid) return { ok: false, reason: `invalid_${asset.kind}_content:${validation.error}` };
    const entries = indexedEntries(JSON.parse(content), asset.kind);
    if (validation.entryCount !== entries.length) return { ok: false, reason: "content_index_mismatch" };
    return { ok: true, sha256: decoded.sha256, entries };
  } catch (error) {
    return {
      ok: false,
      reason: `invalid_${asset.kind}_content:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validatedAssetContent(source, kind, projectId, skipped) {
  const decoded = decodeAsset(source);
  if (!decoded.ok) {
    if (kind === "cover") {
      skipped.push({ project_id: projectId, reason: `cover_${decoded.reason}` });
      return { omitted: true };
    }
    return { ok: false, reason: `${kind}_${decoded.reason}` };
  }
  const content = kind === "cover" ? { ok: true, sha256: decoded.sha256, entries: [] } : validateContentAsset(source);
  return content.ok ? content : { ok: false, reason: `${kind}_${content.reason}` };
}

export function assetRows(project, revision, sourceAssets, skipped) {
  const byKind = new Map();
  for (const source of sourceAssets) {
    const kind = text(source.kind);
    if (!["worldbook", "regex", "cover"].includes(kind)) {
      skipped.push({ project_id: project.id, reason: `unsupported_asset_kind:${kind || "missing"}` });
      continue;
    }
    if (!text(source.r2_key)) {
      const reason = `asset_${kind}_missing_r2_key`;
      if (kind !== "cover") return { ok: false, reason };
      skipped.push({ project_id: project.id, reason });
      continue;
    }
    if (byKind.has(kind)) return { ok: false, reason: `duplicate_${kind}_asset` };
    const content = validatedAssetContent(source, kind, project.id, skipped);
    if (content.omitted) continue;
    if (!content.ok) return content;
    byKind.set(kind, {
      id: generatedId("asset", `${project.id}:${revision.id}:${kind}`),
      project_id: project.id,
      revision_id: revision.id,
      kind,
      r2_key: kind === "cover" ? `covers/imported/${content.sha256}` : text(source.r2_key),
      source_key: text(source.r2_key),
      sha256: content.sha256,
      bytes: source.bytes,
      mime: text(source.mime || (kind === "cover" ? "application/octet-stream" : "application/json")),
      created_at: revision.created_at,
      entries: content.entries,
    });
  }
  if (!byKind.has("worldbook") && !byKind.has("regex")) return { ok: false, reason: "missing_released_content" };
  return { ok: true, values: [...byKind.values()] };
}

export function manifestHash(assets) {
  return hash(
    [...assets]
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.r2_key.localeCompare(right.r2_key))
      .map((asset) => `${asset.kind}:${asset.sha256}`)
      .join("\n"),
  );
}
