-- The public cache gateway fails closed when its generation is absent. Seed a
-- valid initial namespace for a newly migrated, otherwise empty database.
INSERT OR IGNORE INTO site_settings (key, value, updated_at)
VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP);

-- Banner and site content are public projections and must invalidate their
-- namespace with the setting mutation.
CREATE TRIGGER IF NOT EXISTS bump_cache_epoch_banner_insert
AFTER INSERT ON site_settings
WHEN NEW.key IN ('discover_banner', 'site_content')
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS bump_cache_epoch_banner_update
AFTER UPDATE OF value ON site_settings
WHEN NEW.key IN ('discover_banner', 'site_content')
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS bump_cache_epoch_public_site_delete
AFTER DELETE ON site_settings
WHEN OLD.key IN ('discover_banner', 'site_content')
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;
