-- Metadata findings belong to the frozen unified review report, not mutable project/version projections.
ALTER TABLE projects DROP COLUMN metadata_findings;
ALTER TABLE projects DROP COLUMN metadata_checker_revision;
ALTER TABLE projects DROP COLUMN metadata_checked_at;
ALTER TABLE projects DROP COLUMN metadata_checked_by;
ALTER TABLE project_revisions DROP COLUMN metadata_findings;
ALTER TABLE project_revisions DROP COLUMN metadata_checker_revision;
ALTER TABLE project_revisions DROP COLUMN metadata_checked_at;
ALTER TABLE project_revisions DROP COLUMN metadata_checked_by;
