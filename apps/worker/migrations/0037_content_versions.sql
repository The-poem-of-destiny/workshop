-- Content versions are the sole content authority. Checker build revisions are unrelated.
ALTER TABLE project_revisions RENAME TO project_versions;
ALTER TABLE project_versions RENAME COLUMN revision_no TO version_no;
ALTER TABLE projects RENAME COLUMN working_revision_id TO working_version_id;
ALTER TABLE projects RENAME COLUMN published_revision_id TO published_version_id;
ALTER TABLE assets RENAME COLUMN revision_id TO version_id;
ALTER TABLE submissions RENAME COLUMN revision_id TO version_id;
ALTER TABLE submissions RENAME COLUMN base_published_revision_id TO base_published_version_id;
ALTER TABLE download_daily_stats RENAME COLUMN revision_id TO project_version_id;
