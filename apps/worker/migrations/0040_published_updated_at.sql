-- Preserve the historical public timestamp without exposing later draft edits.
ALTER TABLE projects ADD COLUMN published_updated_at TEXT;

UPDATE projects
SET published_updated_at = COALESCE(
  (SELECT MAX(s.resolved_at) FROM submissions s
   WHERE s.version_id = projects.published_version_id AND s.status = 'approved'),
  published_at,
  (SELECT r.created_at FROM project_versions r WHERE r.id = projects.published_version_id)
)
WHERE published_version_id IS NOT NULL;
