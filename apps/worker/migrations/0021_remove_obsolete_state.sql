-- Current product state, not the legacy export shape, owns the schema.
-- These columns had no consumer or duplicated the canonical client/checker data.
ALTER TABLE oauth_flows DROP COLUMN verifier_hash;
ALTER TABLE project_revisions DROP COLUMN facets;
ALTER TABLE project_revisions DROP COLUMN custom_tags;
ALTER TABLE project_revisions DROP COLUMN metadata;
ALTER TABLE submissions DROP COLUMN gate;
ALTER TABLE submissions DROP COLUMN checker_revision;
ALTER TABLE reviews DROP COLUMN report;

-- Older releases without a completed persisted index are not supported by the
-- new read model. Keep their content as author history, not as public releases;
-- authors can create a successor and submit through the current validation path.
UPDATE projects
SET published_revision_id = NULL, published_at = NULL, published_cover_asset_id = NULL,
    row_version = row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE published_revision_id IN (SELECT id FROM project_revisions WHERE entry_index_ready = 0);
DELETE FROM revision_entry_index
WHERE revision_id IN (SELECT id FROM project_revisions WHERE entry_index_ready = 0);

-- Avatars are Discord profile data; banners are site settings with their own R2
-- objects. Neither belongs to a project's asset associations. Discard obsolete
-- associations, without deleting any R2 objects or copying retained bytes.
CREATE TABLE assets_current (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id TEXT REFERENCES project_revisions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('worldbook', 'regex', 'cover')),
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (revision_id, kind)
);
INSERT INTO assets_current (id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at)
SELECT id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at
FROM assets WHERE kind IN ('worldbook', 'regex', 'cover');
DROP TABLE assets;
ALTER TABLE assets_current RENAME TO assets;
CREATE INDEX idx_assets_project ON assets(project_id, kind);
CREATE INDEX idx_assets_r2_key ON assets(r2_key);
CREATE UNIQUE INDEX idx_assets_one_display_cover ON assets(project_id)
  WHERE revision_id IS NULL AND kind = 'cover';
