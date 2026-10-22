-- Retained revision assets may reference the same immutable R2 object. The
-- uniqueness that matters is one asset per (revision, kind).
CREATE TABLE assets_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id TEXT REFERENCES project_revisions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('worldbook', 'regex', 'cover', 'avatar', 'banner')),
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (revision_id, kind)
);

INSERT INTO assets_new (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
SELECT id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at FROM assets;

DROP TABLE assets;
ALTER TABLE assets_new RENAME TO assets;
CREATE INDEX idx_assets_project ON assets(project_id, kind);
CREATE INDEX idx_assets_r2_key ON assets(r2_key);
