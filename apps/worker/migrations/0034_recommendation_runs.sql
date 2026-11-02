-- Old ranking results are derived projections, not historical metric authority.
-- Rebuild from preserved project_metrics_daily; never reinterpret old scores as four-pool scores.
CREATE TABLE recommendation_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('daily','7d','30d','discovery')),
  status TEXT NOT NULL CHECK(status IN ('building','complete','failed')),
  scheduled_at TEXT NOT NULL,
  display_start_at TEXT NOT NULL,
  display_end_at TEXT NOT NULL,
  source_start_at TEXT NOT NULL,
  source_end_at TEXT NOT NULL,
  result TEXT CHECK(result IS NULL OR (json_valid(result) AND json_extract(result,'$.schemaVersion')=1
    AND json_extract(result,'$.scoringVersion')='four-pool-v1' AND json_type(result,'$.items')='array')),
  error TEXT,
  CHECK(display_start_at < display_end_at),
  CHECK(source_start_at < source_end_at),
  CHECK(status <> 'complete' OR result IS NOT NULL)
);
CREATE INDEX idx_recommendation_runs_display ON recommendation_runs(kind,status,display_start_at,display_end_at,scheduled_at);
DROP TABLE discovery_exposures;
DROP TABLE ranking_entries;
DROP TABLE ranking_runs;
