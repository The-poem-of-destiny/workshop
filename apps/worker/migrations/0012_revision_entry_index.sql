-- Public entry indexes are derived from immutable revision assets. Persist them
-- when a revision is frozen so anonymous reads do not parse R2 originals.
CREATE TABLE revision_entry_index (
  revision_id TEXT NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('worldbook', 'regex')),
  entry_key TEXT NOT NULL,
  name TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content_length INTEGER NOT NULL CHECK (content_length >= 0),
  PRIMARY KEY (revision_id, kind, entry_key)
);

CREATE INDEX idx_revision_entry_index_revision ON revision_entry_index(revision_id);
