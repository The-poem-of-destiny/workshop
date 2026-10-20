-- Creative Workshop initial schema.
-- This file is the only source of truth for a new database. Existing databases
-- evolve through numbered migrations.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  global_name TEXT,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'reviewer', 'owner')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id, session_version);

CREATE TABLE oauth_flows (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  verifier_hash TEXT,
  origin TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('browser', 'embed', 'device')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'redeemed', 'expired')),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_oauth_flows_status ON oauth_flows(status, expires_at);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  author_note TEXT,
  project_type TEXT,
  extension_type TEXT,
  search_tags TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  working_revision_id TEXT,
  published_revision_id TEXT,
  published_at TEXT,
  downloads_count INTEGER NOT NULL DEFAULT 0,
  likes_count INTEGER NOT NULL DEFAULT 0,
  subscriptions_count INTEGER NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE INDEX idx_projects_author ON projects(author_id, updated_at DESC);
CREATE INDEX idx_projects_public ON projects(visibility, published_revision_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE project_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  author_note TEXT,
  project_type TEXT,
  extension_type TEXT,
  facets TEXT NOT NULL DEFAULT '{}',
  custom_tags TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  manifest_hash TEXT,
  worldbook_count INTEGER NOT NULL DEFAULT 0,
  regex_count INTEGER NOT NULL DEFAULT 0,
  schema_version TEXT,
  discord_thread_url TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, revision_no)
);

CREATE INDEX idx_project_revisions_project ON project_revisions(project_id, revision_no DESC);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id TEXT REFERENCES project_revisions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('worldbook', 'regex', 'cover', 'avatar', 'banner')),
  r2_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (revision_id, kind)
);

CREATE INDEX idx_assets_project ON assets(project_id, kind);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'checking', 'approved', 'rejected', 'superseded')),
  gate TEXT CHECK (gate IN ('pass', 'warn', 'block', 'missing')),
  checker_revision TEXT,
  submitted_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

CREATE UNIQUE INDEX idx_submissions_one_pending
  ON submissions(project_id)
  WHERE status IN ('pending', 'checking');
CREATE INDEX idx_submissions_status ON submissions(status, submitted_at);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  reason TEXT,
  manifest_hash TEXT,
  checker_version TEXT,
  report TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_reviews_reviewer ON reviews(reviewer_id, created_at DESC);

CREATE TABLE project_likes (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX idx_project_likes_user ON project_likes(user_id, created_at DESC);

CREATE TABLE project_subscriptions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX idx_project_subscriptions_user ON project_subscriptions(user_id, created_at DESC);

CREATE TRIGGER project_likes_count_insert AFTER INSERT ON project_likes
BEGIN
  UPDATE projects SET likes_count = likes_count + 1 WHERE id = NEW.project_id;
END;

CREATE TRIGGER project_likes_count_delete AFTER DELETE ON project_likes
BEGIN
  UPDATE projects SET likes_count = MAX(likes_count - 1, 0) WHERE id = OLD.project_id;
END;

CREATE TRIGGER project_subscriptions_count_insert AFTER INSERT ON project_subscriptions
BEGIN
  UPDATE projects SET subscriptions_count = subscriptions_count + 1 WHERE id = NEW.project_id;
END;

CREATE TRIGGER project_subscriptions_count_delete AFTER DELETE ON project_subscriptions
BEGIN
  UPDATE projects SET subscriptions_count = MAX(subscriptions_count - 1, 0) WHERE id = OLD.project_id;
END;

CREATE TABLE project_ratings (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX idx_project_ratings_project ON project_ratings(project_id, rating);

CREATE TABLE project_metrics_daily (
  day_key TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  downloads INTEGER NOT NULL DEFAULT 0,
  likes_delta INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day_key, project_id)
);

CREATE INDEX idx_project_metrics_project ON project_metrics_daily(project_id, day_key DESC);

CREATE TABLE ranking_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('daily', '7d', '30d')),
  bucket TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'complete')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  UNIQUE (kind, bucket)
);

CREATE TABLE ranking_entries (
  run_id TEXT NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  score REAL,
  PRIMARY KEY (run_id, rank),
  UNIQUE (run_id, project_id)
);

CREATE TABLE discovery_exposures (
  bucket TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (bucket, project_id)
);

CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  curator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  comment TEXT NOT NULL DEFAULT '',
  reaction TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (curator_id, project_id)
);

CREATE INDEX idx_recommendations_project ON recommendations(project_id, updated_at DESC);

CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE reference_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE reference_versions (
  id TEXT PRIMARY KEY,
  reference_set_id TEXT NOT NULL REFERENCES reference_sets(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  version_ordinal INTEGER NOT NULL,
  grace_until TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (reference_set_id, version_label),
  UNIQUE (reference_set_id, version_ordinal)
);

CREATE INDEX idx_reference_versions_latest
  ON reference_versions(reference_set_id, version_ordinal DESC);

CREATE TABLE reference_items (
  id TEXT PRIMARY KEY,
  reference_version_id TEXT NOT NULL REFERENCES reference_versions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('worldbook', 'regex')),
  source_key TEXT,
  display_name TEXT NOT NULL,
  exact_hash TEXT NOT NULL,
  normalized_content_hash TEXT NOT NULL,
  name_hash TEXT NOT NULL,
  keys_hash TEXT,
  structure_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_reference_items_version ON reference_items(reference_version_id, kind);
CREATE INDEX idx_reference_items_exact ON reference_items(kind, exact_hash);
CREATE INDEX idx_reference_items_name ON reference_items(kind, name_hash);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_audit_events_target ON audit_events(target_type, target_id, created_at DESC);
CREATE INDEX idx_audit_events_actor ON audit_events(actor_id, created_at DESC);

-- Search: trigram FTS for >=3 character queries and a spaced-character index
-- for 1-2 character Chinese queries. Both are maintained by triggers so a
-- forgotten application write cannot silently desynchronize search.
CREATE TABLE project_search_tags (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (project_id, tag)
);

CREATE INDEX idx_project_search_tags_tag ON project_search_tags(tag, project_id);

CREATE VIRTUAL TABLE project_search USING fts5(
  title,
  project_type,
  extension_type,
  tag_text,
  author_name,
  tokenize = 'trigram'
);

CREATE VIEW project_search_short_source AS
SELECT p.rowid AS project_rowid,
       (WITH RECURSIVE chars(text, n) AS (
           SELECT COALESCE(p.title, '') || char(31)
               || COALESCE(p.project_type, '') || char(31)
               || COALESCE(p.extension_type, '') || char(31)
               || COALESCE(u.global_name, '') || char(31)
               || COALESCE(u.username, '') || char(31)
               || COALESCE((SELECT group_concat(tag, char(31))
                              FROM project_search_tags t
                              WHERE t.project_id = p.id), ''), 1
           UNION ALL
           SELECT text, n + 1 FROM chars WHERE n < length(text)
       ) SELECT group_concat(substr(text, n, 1), ' ') FROM chars) AS spaced_text
FROM projects p
LEFT JOIN users u ON u.id = p.author_id;

CREATE VIRTUAL TABLE project_search_short USING fts5(spaced_text);

CREATE TRIGGER project_search_insert
AFTER INSERT ON projects
BEGIN
  INSERT INTO project_search_tags (project_id, tag)
  SELECT NEW.id, value FROM (
    SELECT value FROM json_each(CASE WHEN json_valid(NEW.search_tags) THEN NEW.search_tags ELSE '[]' END) WHERE type = 'text'
    UNION
    SELECT NEW.extension_type WHERE NEW.extension_type IS NOT NULL
  ) WHERE value <> '';

  INSERT INTO project_search (rowid, title, project_type, extension_type, tag_text, author_name)
  VALUES (
    NEW.rowid,
    NEW.title,
    NEW.project_type,
    NEW.extension_type,
    COALESCE((SELECT group_concat(tag, ' ') FROM project_search_tags t WHERE t.project_id = NEW.id), ''),
    (SELECT COALESCE(global_name, username) FROM users WHERE id = NEW.author_id)
  );

  INSERT INTO project_search_short (rowid, spaced_text)
  SELECT project_rowid, spaced_text FROM project_search_short_source WHERE project_rowid = NEW.rowid;
END;

CREATE TRIGGER project_search_update
AFTER UPDATE OF title, project_type, extension_type, search_tags, author_id, updated_at ON projects
BEGIN
  DELETE FROM project_search_tags WHERE project_id = OLD.id;
  INSERT INTO project_search_tags (project_id, tag)
  SELECT NEW.id, value FROM (
    SELECT value FROM json_each(CASE WHEN json_valid(NEW.search_tags) THEN NEW.search_tags ELSE '[]' END) WHERE type = 'text'
    UNION
    SELECT NEW.extension_type WHERE NEW.extension_type IS NOT NULL
  ) WHERE value <> '';

  DELETE FROM project_search WHERE rowid = OLD.rowid;
  INSERT INTO project_search (rowid, title, project_type, extension_type, tag_text, author_name)
  VALUES (
    NEW.rowid,
    NEW.title,
    NEW.project_type,
    NEW.extension_type,
    COALESCE((SELECT group_concat(tag, ' ') FROM project_search_tags t WHERE t.project_id = NEW.id), ''),
    (SELECT COALESCE(global_name, username) FROM users WHERE id = NEW.author_id)
  );

  DELETE FROM project_search_short WHERE rowid = OLD.rowid;
  INSERT INTO project_search_short (rowid, spaced_text)
  SELECT project_rowid, spaced_text FROM project_search_short_source WHERE project_rowid = NEW.rowid;
END;

CREATE TRIGGER project_search_delete
AFTER DELETE ON projects
BEGIN
  DELETE FROM project_search WHERE rowid = OLD.rowid;
  DELETE FROM project_search_short WHERE rowid = OLD.rowid;
  DELETE FROM project_search_tags WHERE project_id = OLD.id;
END;

CREATE TRIGGER project_search_author_update
AFTER UPDATE OF global_name, username ON users
WHEN OLD.global_name IS NOT NEW.global_name OR OLD.username IS NOT NEW.username
BEGIN
  UPDATE project_search
  SET author_name = COALESCE(NEW.global_name, NEW.username)
  WHERE rowid IN (SELECT rowid FROM projects WHERE author_id = NEW.id);

  DELETE FROM project_search_short
  WHERE rowid IN (SELECT rowid FROM projects WHERE author_id = NEW.id);
  INSERT INTO project_search_short (rowid, spaced_text)
  SELECT project_rowid, spaced_text FROM project_search_short_source
  WHERE project_rowid IN (SELECT rowid FROM projects WHERE author_id = NEW.id);
END;
