-- D-30 keeps mutable public-only display metadata outside frozen revisions.
ALTER TABLE projects ADD COLUMN published_schema_version TEXT;
ALTER TABLE projects ADD COLUMN published_discord_thread_url TEXT;

-- Existing published rows need an explicit value so a later NULL edit means
-- "clear", not "fall back to the immutable revision".
UPDATE projects
SET published_schema_version = (
      SELECT schema_version FROM project_revisions WHERE id = projects.published_revision_id
    ),
    published_discord_thread_url = (
      SELECT discord_thread_url FROM project_revisions WHERE id = projects.published_revision_id
    )
WHERE published_revision_id IS NOT NULL;

-- Both display overrides are part of the public projection and must advance
-- the cache namespace in the same D1 transaction as their mutation.
DROP TRIGGER IF EXISTS bump_cache_epoch_projects_update;
CREATE TRIGGER bump_cache_epoch_projects_update
AFTER UPDATE OF title, description, author_note, project_type, extension_type,
  search_tags, visibility, working_revision_id, published_revision_id, published_at,
  deleted_at, version_label, precautions, cover_position_x, cover_position_y,
  cover_zoom, metadata_findings, published_cover_asset_id, published_schema_version,
  published_discord_thread_url ON projects
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;
