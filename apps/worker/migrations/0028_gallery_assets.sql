-- Preserve object keys and bytes; only associations change. No R2 deletion.
CREATE UNIQUE INDEX idx_project_revisions_owner ON project_revisions(project_id, id);
CREATE TABLE assets_next (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  revision_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('worldbook','regex','cover','gallery_1','gallery_2')),
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes >= 0),
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(project_id, revision_id) REFERENCES project_revisions(project_id,id) ON DELETE RESTRICT,
  CHECK(kind NOT IN ('gallery_1','gallery_2') OR revision_id IS NULL),
  CHECK(kind NOT IN ('worldbook','regex') OR revision_id IS NOT NULL),
  UNIQUE(revision_id,kind)
);
INSERT INTO assets_next SELECT id, project_id, revision_id, kind, r2_key, sha256, bytes, mime, created_at FROM assets;
INSERT INTO assets_next (id,project_id,kind,r2_key,sha256,bytes,mime,created_at)
SELECT 'gallery:' || project_id || ':' || slot, project_id,
  CASE slot WHEN 0 THEN 'gallery_1' ELSE 'gallery_2' END,
  r2_key,sha256,bytes,mime,created_at FROM project_gallery;
DROP TABLE assets;
ALTER TABLE assets_next RENAME TO assets;
CREATE INDEX idx_assets_project ON assets(project_id,kind);
CREATE INDEX idx_assets_r2_key ON assets(r2_key);
CREATE UNIQUE INDEX idx_assets_display_kind ON assets(project_id,kind) WHERE revision_id IS NULL;
DROP TABLE project_gallery;
