-- Project-level published display gallery. Slots are stable and bounded so
-- replacing an image does not require revision churn.
CREATE TABLE project_gallery (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot IN (0, 1)),
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, slot)
);
CREATE INDEX idx_project_gallery_r2_key ON project_gallery(r2_key);

CREATE TRIGGER bump_cache_epoch_gallery_insert
AFTER INSERT ON project_gallery
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;
CREATE TRIGGER bump_cache_epoch_gallery_update
AFTER UPDATE ON project_gallery
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;
CREATE TRIGGER bump_cache_epoch_gallery_delete
AFTER DELETE ON project_gallery
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;
