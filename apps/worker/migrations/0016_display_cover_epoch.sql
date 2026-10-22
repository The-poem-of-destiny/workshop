-- Project-level published cover swaps are public projection changes.
DROP TRIGGER IF EXISTS bump_cache_epoch_projects_update;
CREATE TRIGGER bump_cache_epoch_projects_update
AFTER UPDATE OF title, description, author_note, project_type, extension_type,
  search_tags, visibility, working_revision_id, published_revision_id, published_at,
  deleted_at, version_label, precautions, cover_position_x, cover_position_y,
  cover_zoom, metadata_findings, published_cover_asset_id ON projects
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;
