-- Optimize current-user interaction lookups used by project list enrichment.
-- The table primary keys are (project_id, user_id), while these reads start from user_id.

CREATE INDEX IF NOT EXISTS idx_project_likes_user_project
    ON project_likes(user_id, project_id);

CREATE INDEX IF NOT EXISTS idx_project_subscribes_user_project
    ON project_subscribes(user_id, project_id);
