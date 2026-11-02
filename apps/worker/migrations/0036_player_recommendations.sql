-- Bind legacy recommendations only when their creation postdates the current publication.
-- Unknown version attribution remains in the immutable source backup, never a new endorsement.
CREATE TABLE recommendations_next (
  id TEXT PRIMARY KEY,
  curator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  project_version_id TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '' CHECK(length(comment)<=2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(curator_id,project_version_id),
  FOREIGN KEY(project_id,project_version_id) REFERENCES project_revisions(project_id,id) ON DELETE RESTRICT
);
INSERT INTO recommendations_next(id,curator_id,project_id,project_version_id,comment,created_at,updated_at)
SELECT rec.id,rec.curator_id,rec.project_id,p.published_revision_id,rec.comment,rec.created_at,rec.updated_at
FROM recommendations rec JOIN projects p ON p.id=rec.project_id
JOIN project_revisions r ON r.id=p.published_revision_id AND r.project_id=p.id
WHERE p.published_at IS NOT NULL AND p.published_at<=rec.created_at AND r.created_at<=rec.created_at;
DROP TABLE recommendations;
ALTER TABLE recommendations_next RENAME TO recommendations;
CREATE INDEX idx_recommendations_project_version ON recommendations(project_id,project_version_id,updated_at DESC);
