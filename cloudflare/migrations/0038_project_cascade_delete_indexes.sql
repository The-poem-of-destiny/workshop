-- Deleting one project cascades into every child table that references
-- projects(id). SQLite cannot use a foreign-key index for the cascade lookup:
-- it scans each child table once per deleted parent row unless a usable index
-- leads with the referencing column.
--
-- Only two of those child tables had no index leading with project_id:
--   project_metric_daily   PRIMARY KEY (day_key, project_id)
--   project_daily_rankings PRIMARY KEY (ranking_day, project_id)
-- Both keys lead with the day, so a `DELETE FROM projects WHERE id = ?` scanned
-- them in full. On the 2026-10-28 snapshot that was ~57,000 rows visited per
-- deletion (project_metric_daily alone accounts for ~44,000 of it); with the
-- indexes below the same deletion visits ~10,500. Production showed single
-- deletions reading 16,930 rows each, 540k rows a day in 32 calls.
--
-- project_subscribes, project_likes, project_ratings, project_search_tags,
-- devteam_recommendations, discovery_feature_history and
-- project_metadata_audit_logs already have a project_id-leading index and are
-- untouched here.
CREATE INDEX IF NOT EXISTS idx_project_metric_daily_project
    ON project_metric_daily(project_id);

CREATE INDEX IF NOT EXISTS idx_project_daily_rankings_project
    ON project_daily_rankings(project_id);
