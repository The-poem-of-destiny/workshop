-- UTC timestamps. Legacy daily net deltas cannot recover intraday timing:
-- preserve them once at UTC midnight and label their source explicitly.
CREATE TABLE project_like_events (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('legacy_daily', 'interaction')),
  CHECK (source = 'legacy_daily' OR delta IN (-1, 1))
);
CREATE INDEX idx_like_events_time_project ON project_like_events(occurred_at, project_id);
CREATE INDEX idx_download_events_time_project ON download_events(created_at, project_id);

INSERT INTO project_like_events (project_id, delta, occurred_at, source)
SELECT project_id, likes_delta, day_key || 'T00:00:00.000Z', 'legacy_daily'
FROM project_metrics_daily WHERE likes_delta <> 0;

-- Existing daily metrics triggers remain the source for discovery/rankings.
-- These triggers run only on actual state changes, not ignored INSERTs or
-- DELETEs matching no row, so repeated set/unset requests emit no event.
CREATE TRIGGER project_like_event_insert AFTER INSERT ON project_likes
BEGIN
  INSERT INTO project_like_events (project_id, delta, occurred_at, source)
  VALUES (NEW.project_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'interaction');
END;
CREATE TRIGGER project_like_event_delete AFTER DELETE ON project_likes
BEGIN
  INSERT INTO project_like_events (project_id, delta, occurred_at, source)
  SELECT OLD.project_id, -1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'interaction'
  WHERE EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id);
END;
