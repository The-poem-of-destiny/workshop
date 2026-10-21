-- Public read cache invalidation epoch. Triggers advance the epoch on any write
-- that can change a public projection, so cache keys change atomically with D1.
CREATE TRIGGER bump_cache_epoch_projects_insert
AFTER INSERT ON projects
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER bump_cache_epoch_projects_update
AFTER UPDATE ON projects
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER bump_cache_epoch_projects_delete
AFTER DELETE ON projects
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER bump_cache_epoch_likes_insert
AFTER INSERT ON project_likes
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER bump_cache_epoch_likes_delete
AFTER DELETE ON project_likes
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER bump_cache_epoch_metrics
AFTER INSERT ON project_metrics_daily
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER bump_cache_epoch_metrics_update
AFTER UPDATE ON project_metrics_daily
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER bump_cache_epoch_discovery_insert
AFTER INSERT ON discovery_exposures
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER bump_cache_epoch_discovery_delete
AFTER DELETE ON discovery_exposures
BEGIN
  INSERT INTO site_settings (key, value, updated_at) VALUES ('cache_epoch', '1', CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP;
END;
