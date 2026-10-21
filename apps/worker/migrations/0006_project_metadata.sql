ALTER TABLE projects ADD COLUMN version_label TEXT;
ALTER TABLE projects ADD COLUMN precautions TEXT;
ALTER TABLE projects ADD COLUMN cover_position_x REAL NOT NULL DEFAULT 50;
ALTER TABLE projects ADD COLUMN cover_position_y REAL NOT NULL DEFAULT 50;
ALTER TABLE projects ADD COLUMN cover_zoom REAL NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN metadata_findings TEXT NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN metadata_checker_revision TEXT;
ALTER TABLE projects ADD COLUMN metadata_checked_at TEXT;
ALTER TABLE projects ADD COLUMN metadata_checked_by TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE project_revisions ADD COLUMN version_label TEXT;
ALTER TABLE project_revisions ADD COLUMN precautions TEXT;
ALTER TABLE project_revisions ADD COLUMN cover_position_x REAL NOT NULL DEFAULT 50;
ALTER TABLE project_revisions ADD COLUMN cover_position_y REAL NOT NULL DEFAULT 50;
ALTER TABLE project_revisions ADD COLUMN cover_zoom REAL NOT NULL DEFAULT 1;
ALTER TABLE project_revisions ADD COLUMN metadata_findings TEXT NOT NULL DEFAULT '[]';
ALTER TABLE project_revisions ADD COLUMN metadata_checker_revision TEXT;
ALTER TABLE project_revisions ADD COLUMN metadata_checked_at TEXT;
ALTER TABLE project_revisions ADD COLUMN metadata_checked_by TEXT REFERENCES users(id) ON DELETE SET NULL;
