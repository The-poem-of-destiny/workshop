-- Existing project_metrics_daily is authoritative for historical aggregates.
-- Legacy events have no version attribution; never invent version/user detail.
DROP TRIGGER IF EXISTS download_events_count;
DROP TRIGGER IF EXISTS project_like_event_insert;
DROP TRIGGER IF EXISTS project_like_event_delete;
DROP TABLE download_tokens;
DROP TABLE download_events;
DROP TABLE project_like_events;

CREATE TABLE download_daily_stats (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  revision_id TEXT NOT NULL,
  day_key TEXT NOT NULL CHECK(length(day_key) = 10 AND date(day_key) IS day_key),
  count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 128),
  first_downloaded_at TEXT NOT NULL,
  last_downloaded_at TEXT NOT NULL,
  acquisition_ids TEXT NOT NULL CHECK(json_valid(acquisition_ids)
    AND json_type(acquisition_ids) = 'array' AND json_array_length(acquisition_ids) = count),
  PRIMARY KEY(user_id, revision_id, day_key),
  FOREIGN KEY(project_id, revision_id) REFERENCES project_revisions(project_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_download_daily_project_day ON download_daily_stats(project_id,day_key,user_id);
-- Only genuine logical acquisitions change aggregates. File GETs never do.
CREATE TRIGGER download_daily_insert AFTER INSERT ON download_daily_stats
WHEN EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id = NEW.user_id
  WHERE p.id = NEW.project_id AND p.visibility = 'public' AND p.deleted_at IS NULL
    AND p.author_id <> NEW.user_id AND u.role NOT IN ('reviewer','owner'))
BEGIN
  UPDATE projects SET downloads_count = downloads_count + 1 WHERE id = NEW.project_id;
  INSERT INTO project_metrics_daily(day_key,project_id,downloads) VALUES(NEW.day_key,NEW.project_id,1)
  ON CONFLICT(day_key,project_id) DO UPDATE SET downloads = downloads + 1;
END;
CREATE TRIGGER download_daily_update AFTER UPDATE OF count ON download_daily_stats
WHEN NEW.count > OLD.count AND EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id = NEW.user_id
  WHERE p.id = NEW.project_id AND p.visibility = 'public' AND p.deleted_at IS NULL
    AND p.author_id <> NEW.user_id AND u.role NOT IN ('reviewer','owner'))
BEGIN
  UPDATE projects SET downloads_count = downloads_count + NEW.count - OLD.count WHERE id = NEW.project_id;
  INSERT INTO project_metrics_daily(day_key,project_id,downloads) VALUES(NEW.day_key,NEW.project_id,NEW.count-OLD.count)
  ON CONFLICT(day_key,project_id) DO UPDATE SET downloads = downloads + NEW.count - OLD.count;
END;
