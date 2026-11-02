import {
  normalizeExtensionType,
  normalizeProjectType,
  resolveProjectType,
} from "../../packages/domain/src/taxonomy.ts";
import { generatedId, text } from "./values.mjs";

export function publicProject(row) {
  return row?.status === "approved" && Number(row.is_published) === 1 && Number(row.visibility) === 1;
}

function timestamps(row) {
  const createdAt = text(row.created_at || row.createdAt);
  const updatedAt = text(row.updated_at || row.updatedAt || createdAt);
  return createdAt && updatedAt ? { created_at: createdAt, updated_at: updatedAt } : null;
}

function stringArray(value) {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })()
      : value;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
}

export function sourceMembers(rawUsers) {
  const userById = new Map();
  for (const user of rawUsers) {
    const id = text(user.id);
    const username = text(user.username);
    const times = timestamps(user);
    if (id && username && times && !userById.has(id)) userById.set(id, { ...user, id, username, times });
  }
  return userById;
}

export function sourceAssetsByProject(rawAssets) {
  const assetsByProject = new Map();
  for (const asset of rawAssets) {
    const projectId = text(asset.project_id);
    if (!projectId) continue;
    const rows = assetsByProject.get(projectId) ?? [];
    rows.push(asset);
    assetsByProject.set(projectId, rows);
  }
  return assetsByProject;
}

export function projectRows(sourceProject, userById, projects, skipped) {
  const id = text(sourceProject.id);
  const authorId = text(sourceProject.author_id);
  const author = userById.get(authorId);
  const times = timestamps(sourceProject);
  const title = text(sourceProject.name);
  const tags = stringArray(sourceProject.tags);
  const projectType =
    normalizeProjectType(sourceProject.project_type) ??
    (tags.some((tag) => normalizeProjectType(tag)) ? resolveProjectType(null, tags) : null);
  const extensionType = normalizeExtensionType(sourceProject.extension_type);
  if (!id || !author || !times || !title.trim()) {
    skipped.push({
      project_id: id || null,
      reason: !author ? "missing_member_author" : "missing_required_project_fields",
    });
    return null;
  }
  if (projects.some((project) => project.id === id)) {
    skipped.push({ project_id: id, reason: "duplicate_project_id" });
    return null;
  }
  const version = {
    id: generatedId("revision", id),
    project_id: id,
    version_no: 1,
    title,
    description: sourceProject.description ?? null,
    author_note: null,
    project_type: projectType,
    extension_type: extensionType,
    tags: JSON.stringify(tags),
    manifest_hash: null,
    worldbook_count: 0,
    regex_count: 0,
    schema_version: null,
    discord_thread_url: sourceProject.discord_thread_url ?? null,
    created_by: authorId,
    created_at: times.created_at,
    version_label: sourceProject.version_label ?? sourceProject.version ?? null,
    requirements:
      sourceProject.precautions == null
        ? null
        : JSON.stringify({ schemaVersion: 1, dependencies: [], conflicts: [], notes: sourceProject.precautions }),
    cover_position_x: Number.isFinite(sourceProject.cover_position_x) ? sourceProject.cover_position_x : 50,
    cover_position_y: Number.isFinite(sourceProject.cover_position_y) ? sourceProject.cover_position_y : 50,
    cover_zoom: Number.isFinite(sourceProject.cover_zoom) ? sourceProject.cover_zoom : 1,
    entry_index: null,
  };
  const project = {
    id,
    author_id: authorId,
    visibility: "public",
    working_version_id: version.id,
    published_version_id: version.id,
    published_at: sourceProject.latest_approved_at ?? sourceProject.reviewed_at ?? times.updated_at,
    row_version: 1,
    created_at: times.created_at,
    updated_at: times.updated_at,
  };
  return { project, version, author };
}

export function memberRow(author) {
  return {
    id: author.id,
    username: author.username,
    global_name: author.global_name ?? null,
    avatar: author.avatar ?? null,
    role: "member",
    created_at: author.times.created_at,
    updated_at: author.times.updated_at,
  };
}
