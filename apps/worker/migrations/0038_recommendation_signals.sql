-- Client-reported sampled aggregate signals, not authoritative impressions or user profiles.
-- One bounded aggregate per sampled authenticated player/run; no exposure event log.
CREATE TABLE recommendation_signals (
  reporter_hash TEXT NOT NULL CHECK(length(reporter_hash)=64),
  run_id TEXT NOT NULL REFERENCES recommendation_runs(id) ON DELETE RESTRICT,
  visible_projects TEXT NOT NULL CHECK(json_valid(visible_projects) AND json_type(visible_projects)='array' AND json_array_length(visible_projects)<=24),
  clicked_projects TEXT NOT NULL CHECK(json_valid(clicked_projects) AND json_type(clicked_projects)='array' AND json_array_length(clicked_projects)<=24),
  writes INTEGER NOT NULL CHECK(writes BETWEEN 1 AND 4),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(reporter_hash,run_id)
);
CREATE INDEX idx_recommendation_signals_run ON recommendation_signals(run_id);
CREATE TABLE project_change_signals (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  project_version_id TEXT NOT NULL,
  previous_version_id TEXT NOT NULL,
  previous_manifest_hash TEXT NOT NULL,
  current_manifest_hash TEXT NOT NULL,
  changed_entries INTEGER NOT NULL CHECK(changed_entries BETWEEN 1 AND 20000),
  total_entries INTEGER NOT NULL CHECK(total_entries BETWEEN changed_entries AND 20000),
  reported_at TEXT NOT NULL,
  PRIMARY KEY(project_version_id),
  FOREIGN KEY(project_id,project_version_id) REFERENCES project_versions(project_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id,previous_version_id) REFERENCES project_versions(project_id,id) ON DELETE RESTRICT
);
