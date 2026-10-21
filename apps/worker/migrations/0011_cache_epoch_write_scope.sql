-- Likes and download metrics are display values with a short public TTL.
-- They must not let any member invalidate the global public cache epoch.
DROP TRIGGER IF EXISTS bump_cache_epoch_likes_insert;
DROP TRIGGER IF EXISTS bump_cache_epoch_likes_delete;
DROP TRIGGER IF EXISTS bump_cache_epoch_metrics;
DROP TRIGGER IF EXISTS bump_cache_epoch_metrics_update;

-- Only public-projection fields advance the epoch; counter-only updates from
-- likes/downloads must not let any member bust the shared cache.
DROP TRIGGER IF EXISTS bump_cache_epoch_projects_update;
CREATE TRIGGER bump_cache_epoch_projects_update
AFTER UPDATE OF title, description, author_note, project_type, extension_type,
  search_tags, visibility, working_revision_id, published_revision_id, published_at,
  deleted_at, version_label, precautions, cover_position_x, cover_position_y,
  cover_zoom, metadata_findings ON projects
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;
