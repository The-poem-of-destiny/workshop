-- Store the public like total on projects so list reads do not recount project_likes.
ALTER TABLE projects ADD COLUMN likes_count INTEGER NOT NULL DEFAULT 0;

-- One-time backfill for existing data.
UPDATE projects
SET likes_count = (
    SELECT COUNT(*)
    FROM project_likes
    WHERE project_likes.project_id = projects.id
);

-- Keep the counter correct for old and new clients that write project_likes directly.
CREATE TRIGGER IF NOT EXISTS trg_project_likes_after_insert
AFTER INSERT ON project_likes
BEGIN
    UPDATE projects
    SET likes_count = COALESCE(likes_count, 0) + 1
    WHERE id = NEW.project_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_project_likes_after_delete
AFTER DELETE ON project_likes
BEGIN
    UPDATE projects
    SET likes_count = MAX(COALESCE(likes_count, 0) - 1, 0)
    WHERE id = OLD.project_id;
END;

CREATE INDEX IF NOT EXISTS idx_projects_public_likes
    ON projects(status, is_published, visibility, likes_count DESC, created_at DESC);
