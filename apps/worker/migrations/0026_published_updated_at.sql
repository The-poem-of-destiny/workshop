-- Preserve the historical public timestamp without exposing later draft edits.
ALTER TABLE projects ADD COLUMN published_updated_at TEXT;

UPDATE projects
SET published_updated_at = COALESCE(
  (SELECT MAX(s.resolved_at) FROM submissions s
   WHERE s.revision_id = projects.published_revision_id AND s.status = 'approved'),
  published_at,
  (SELECT r.created_at FROM project_revisions r WHERE r.id = projects.published_revision_id)
)
WHERE published_revision_id IS NOT NULL;
