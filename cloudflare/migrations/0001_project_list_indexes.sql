-- Optimize the public project-list filters and the three non-social sort modes.
-- Safe for existing databases: every index creation is idempotent.

CREATE INDEX IF NOT EXISTS idx_projects_public_created
    ON projects(status, is_published, visibility, created_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_public_updated
    ON projects(status, is_published, visibility, updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_public_downloads
    ON projects(status, is_published, visibility, downloads_count DESC, created_at DESC);
