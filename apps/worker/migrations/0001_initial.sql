-- Final target schema for a clean database only; never apply as an upgrade.

-- Durable Object migration classes remain separately configured in wrangler.jsonc.

CREATE TABLE "assets" (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  version_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('worldbook','regex','cover','gallery_1','gallery_2')),
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes >= 0),
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(project_id, version_id) REFERENCES "project_versions"(project_id,id) ON DELETE RESTRICT,
  CHECK(kind NOT IN ('gallery_1','gallery_2') OR version_id IS NULL),
  CHECK(kind NOT IN ('worldbook','regex') OR version_id IS NOT NULL),
  UNIQUE(version_id,kind)
,
  UNIQUE(project_id,id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE automated_reviews (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('queued','running','done','needs_human','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  lease_until TEXT,
  lease_token TEXT,
  error TEXT,
  client_gate TEXT NOT NULL CHECK(client_gate IN ('pass','warn','block','missing')),
  client_checker_version TEXT,
  checker_version TEXT,
  route_gate TEXT CHECK(route_gate IN ('pass','warn','block')),
  report_r2_key TEXT,
  report_hash TEXT,
  duration_ms INTEGER CHECK(duration_ms >= 0),
  checked_at TEXT,
  report_cleaned_at TEXT,
  CHECK(report_r2_key IS NULL OR (report_hash IS NOT NULL AND report_cleaned_at IS NULL)),
  CHECK(report_r2_key IS NOT NULL OR report_hash IS NULL OR report_cleaned_at IS NOT NULL),
  CHECK(report_cleaned_at IS NULL OR (report_r2_key IS NULL AND report_hash IS NOT NULL AND checked_at IS NOT NULL))
);

CREATE TABLE download_daily_stats (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  project_version_id TEXT NOT NULL,
  day_key TEXT NOT NULL CHECK(length(day_key) = 10 AND date(day_key) IS day_key),
  count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 128),
  first_downloaded_at TEXT NOT NULL,
  last_downloaded_at TEXT NOT NULL,
  acquisition_ids TEXT NOT NULL CHECK(json_valid(acquisition_ids)
    AND json_type(acquisition_ids) = 'array' AND json_array_length(acquisition_ids) = count),
  PRIMARY KEY(user_id, project_version_id, day_key),
  FOREIGN KEY(project_id, project_version_id) REFERENCES "project_versions"(project_id,id) ON DELETE RESTRICT
);

CREATE TABLE manual_reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE RESTRICT,
  reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
  reason TEXT,
  manifest_hash TEXT,
  checker_version TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE oauth_flows (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('browser', 'embed', 'device')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'redeemed', 'expired')),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, code_verifier TEXT, code_challenge TEXT, redeem_hash TEXT, error TEXT, authorized_at TEXT, browser_binding_hash TEXT, detail TEXT
  CHECK (detail IS NULL OR (json_valid(detail)
    AND json_extract(detail, '$.schemaVersion') = 1
    AND json_type(detail, '$.guildId') = 'text'
    AND json_extract(detail, '$.eligibility') = 'member'
    AND json_type(detail, '$.verifiedAt') = 'text')));

CREATE TABLE project_change_signals (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  project_version_id TEXT NOT NULL,
  previous_version_id TEXT NOT NULL,
  previous_manifest_hash TEXT NOT NULL,
  current_manifest_hash TEXT NOT NULL,
  changed_entries INTEGER NOT NULL CHECK(changed_entries BETWEEN 1 AND 20000),
  total_entries INTEGER NOT NULL CHECK(total_entries BETWEEN changed_entries AND 20000),
  reported_at TEXT NOT NULL,
  PRIMARY KEY(project_version_id),
  FOREIGN KEY(project_id,project_version_id) REFERENCES project_versions(project_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id,previous_version_id) REFERENCES project_versions(project_id,id) ON DELETE RESTRICT
);

CREATE TABLE project_likes (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE project_metrics_daily (
  day_key TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  downloads INTEGER NOT NULL DEFAULT 0,
  likes_delta INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day_key, project_id)
);

CREATE TABLE project_ratings (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE VIRTUAL TABLE project_search USING fts5(
  title,
  project_type,
  included_types,
  tag_text,
  author_name,
  tokenize = 'trigram'
);

CREATE VIRTUAL TABLE project_search_short USING fts5(spaced_text);

CREATE TABLE project_search_tags (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (project_id, tag)
);

CREATE TABLE project_subscriptions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE "project_versions" (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  project_type TEXT NOT NULL CHECK(project_type IN ('系统核心','角色','内容扩展','玩法','事件','体验优化')),
  included_types TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(included_types) AND json_type(included_types) = 'array'),
  tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags) AND json_type(tags) = 'array' AND json_array_length(tags) <= 20),
  manifest_hash TEXT,
  worldbook_count INTEGER NOT NULL DEFAULT 0,
  regex_count INTEGER NOT NULL DEFAULT 0,
  schema_version TEXT,
  discord_thread_url TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), version_label TEXT, cover_position_x REAL NOT NULL DEFAULT 50, cover_position_y REAL NOT NULL DEFAULT 50, cover_zoom REAL NOT NULL DEFAULT 1, entry_index TEXT
  CHECK(entry_index IS NULL OR (json_valid(entry_index)
    AND json_extract(entry_index,'$.schemaVersion') = 1
    AND json_type(entry_index,'$.entries') = 'array'
    AND length(CAST(entry_index AS BLOB)) <= 512000)), requirements TEXT CHECK(requirements IS NULL OR
  (json_valid(requirements) AND json_extract(requirements,'$.schemaVersion') = 1
    AND json_type(requirements,'$.dependencies') = 'array'
    AND json_type(requirements,'$.conflicts') = 'array'
    AND json_type(requirements,'$.notes') = 'text')),
  UNIQUE (project_id, version_no)
);

-- Validate a NUL-free JSON projection: escaped NUL becomes U+0001, preserving
-- code-point count and trim boundaries without SQLite length() truncation.
-- Store and compare duplicates using the original values, never this projection.
-- The explicit trim set matches JavaScript trim(), including BOM but not U+0085.
CREATE TRIGGER project_versions_taxonomy_insert BEFORE INSERT ON project_versions
WHEN EXISTS(SELECT 1 FROM json_each(NEW.included_types)
    WHERE type <> 'text' OR value NOT IN ('角色','内容扩展','玩法','事件','体验优化') OR value = NEW.project_type)
  OR (SELECT COUNT(*) FROM json_each(NEW.included_types)) <> (SELECT COUNT(DISTINCT value) FROM json_each(NEW.included_types))
  OR EXISTS(SELECT 1 FROM json_each(replace(NEW.tags, '\u0000', '\u0001'))
    WHERE type <> 'text' OR length(value) NOT BETWEEN 1 AND 100
      OR value <> trim(value, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
  OR (SELECT COUNT(*) FROM json_each(NEW.tags)) <> (SELECT COUNT(DISTINCT value) FROM json_each(NEW.tags))
BEGIN SELECT RAISE(ABORT,'invalid project taxonomy or tags'); END;

CREATE TRIGGER project_versions_taxonomy_update BEFORE UPDATE OF project_type,included_types,tags ON project_versions
WHEN EXISTS(SELECT 1 FROM json_each(NEW.included_types)
    WHERE type <> 'text' OR value NOT IN ('角色','内容扩展','玩法','事件','体验优化') OR value = NEW.project_type)
  OR (SELECT COUNT(*) FROM json_each(NEW.included_types)) <> (SELECT COUNT(DISTINCT value) FROM json_each(NEW.included_types))
  OR EXISTS(SELECT 1 FROM json_each(replace(NEW.tags, '\u0000', '\u0001'))
    WHERE type <> 'text' OR length(value) NOT BETWEEN 1 AND 100
      OR value <> trim(value, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
  OR (SELECT COUNT(*) FROM json_each(NEW.tags)) <> (SELECT COUNT(DISTINCT value) FROM json_each(NEW.tags))
BEGIN SELECT RAISE(ABORT,'invalid project taxonomy or tags'); END;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  working_version_id TEXT,
  published_version_id TEXT,
  published_at TEXT,
  downloads_count INTEGER NOT NULL DEFAULT 0,
  likes_count INTEGER NOT NULL DEFAULT 0,
  subscriptions_count INTEGER NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
, published_cover_asset_id TEXT, published_updated_at TEXT,
  FOREIGN KEY(id,working_version_id) REFERENCES project_versions(project_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(id,published_version_id) REFERENCES project_versions(project_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(id,published_cover_asset_id) REFERENCES assets(project_id,id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE recommendation_batches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('discovery')),
  status TEXT NOT NULL CHECK(status IN ('building','complete','failed')),
  scheduled_at TEXT NOT NULL,
  started_at TEXT,
  display_start_at TEXT NOT NULL,
  display_end_at TEXT NOT NULL,
  source_start_at TEXT NOT NULL,
  source_end_at TEXT NOT NULL,
  result TEXT CHECK(result IS NULL OR (json_valid(result) AND json_extract(result,'$.schemaVersion')=1
    AND json_extract(result,'$.scoringVersion')='four-pool-v1' AND json_type(result,'$.items')='array')),
  error TEXT,
  CHECK(display_start_at < display_end_at),
  CHECK(source_start_at < source_end_at),
  CHECK(status <> 'complete' OR result IS NOT NULL)
);

CREATE TABLE recommendation_batch_activations (
  batch_id TEXT PRIMARY KEY REFERENCES recommendation_batches(id) ON DELETE CASCADE,
  hourly_mean TEXT NOT NULL CHECK(json_valid(hourly_mean) AND json_type(hourly_mean)='array' AND json_array_length(hourly_mean)=24),
  activated_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK(ended_at IS NULL OR ended_at >= activated_at)
);

CREATE TABLE recommendation_batch_eligibility (
  batch_id TEXT NOT NULL REFERENCES recommendation_batch_activations(batch_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  project_version_id TEXT NOT NULL,
  ended_at TEXT,
  PRIMARY KEY(batch_id,project_id),
  FOREIGN KEY(project_id,project_version_id) REFERENCES project_versions(project_id,id) ON DELETE RESTRICT
);

CREATE TRIGGER recommendation_eligibility_end AFTER UPDATE OF visibility,deleted_at,published_version_id ON projects
WHEN NEW.visibility <> 'public' OR NEW.deleted_at IS NOT NULL OR NEW.published_version_id IS NOT OLD.published_version_id
BEGIN
  UPDATE recommendation_batch_eligibility SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE project_id=NEW.id AND ended_at IS NULL;
END;

CREATE TABLE "recommendations" (
  id TEXT PRIMARY KEY,
  curator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  project_version_id TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '' CHECK(length(comment)<=2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(curator_id,project_version_id),
  FOREIGN KEY(project_id,project_version_id) REFERENCES "project_versions"(project_id,id) ON DELETE RESTRICT
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

CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'checking', 'approved', 'rejected', 'superseded')),
  submitted_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
, auto_published_at TEXT, base_published_version_id TEXT, withdrawn_at TEXT, withdrawn_by TEXT REFERENCES users(id),
  FOREIGN KEY(project_id,version_id) REFERENCES project_versions(project_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id,base_published_version_id) REFERENCES project_versions(project_id,id) ON DELETE RESTRICT
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  global_name TEXT,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'reviewer', 'owner')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_recommendation_activations_time ON recommendation_batch_activations(activated_at);

CREATE UNIQUE INDEX idx_assets_display_kind ON assets(project_id,kind) WHERE version_id IS NULL;

CREATE INDEX idx_assets_project ON assets(project_id,kind);

CREATE INDEX idx_assets_r2_key ON assets(r2_key);

CREATE INDEX idx_audit_events_actor ON audit_events(actor_id, created_at DESC);

CREATE INDEX idx_audit_events_target ON audit_events(target_type, target_id, created_at DESC);

CREATE INDEX idx_automated_review_queue ON automated_reviews(status,lease_until);

CREATE INDEX idx_download_daily_project_day ON download_daily_stats(project_id,day_key,user_id);

CREATE INDEX idx_oauth_flows_state ON oauth_flows(state_hash);

CREATE INDEX idx_oauth_flows_status ON oauth_flows(status, expires_at);

CREATE INDEX idx_project_likes_user ON project_likes(user_id, created_at DESC);

CREATE INDEX idx_project_metrics_project ON project_metrics_daily(project_id, day_key DESC);

CREATE INDEX idx_project_ratings_project ON project_ratings(project_id, rating);

CREATE UNIQUE INDEX idx_project_revisions_owner ON "project_versions"(project_id, id);

CREATE INDEX idx_project_revisions_project ON "project_versions"(project_id, version_no DESC);

CREATE INDEX idx_project_search_tags_tag ON project_search_tags(tag, project_id);

CREATE INDEX idx_project_subscriptions_user ON project_subscriptions(user_id, created_at DESC);

CREATE INDEX idx_projects_author ON projects(author_id, updated_at DESC);

CREATE INDEX idx_projects_public ON projects(visibility, published_version_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_recommendation_batches_display ON recommendation_batches(kind,status,display_start_at,display_end_at,scheduled_at);

CREATE INDEX idx_recommendations_project_version ON recommendations(project_id,project_version_id,updated_at DESC);

CREATE INDEX idx_sessions_user ON sessions(user_id, session_version);

CREATE UNIQUE INDEX idx_submissions_one_pending
  ON submissions(project_id)
  WHERE status IN ('pending', 'checking');

CREATE INDEX idx_submissions_status ON submissions(status, submitted_at);

CREATE INDEX idx_submissions_status_cursor ON submissions(status, submitted_at, id);

CREATE VIEW project_search_short_source AS
SELECT p.rowid AS project_rowid,
 (WITH RECURSIVE chars(text,n) AS (
   SELECT COALESCE(r.title,'') || char(31) || COALESCE(r.project_type,'') || char(31)
     || COALESCE((SELECT group_concat(value,char(31)) FROM json_each(r.included_types)),'') || char(31) || COALESCE(u.global_name,'') || char(31)
     || COALESCE(u.username,'') || char(31)
     || COALESCE((SELECT group_concat(tag,char(31)) FROM project_search_tags t WHERE t.project_id=p.id),'') ,1
   UNION ALL SELECT text,n+1 FROM chars WHERE n<length(text)
 ) SELECT group_concat(substr(text,n,1),' ') FROM chars) AS spaced_text
FROM projects p JOIN "project_versions" r ON r.id=p.published_version_id
JOIN users u ON u.id=p.author_id;

CREATE TRIGGER audit_action_insert BEFORE INSERT ON audit_events
WHEN NEW.action NOT IN ('member.role_change','site.update','project.patch','project.delete',
  'submission.withdraw','submission.cutover_supersede','companion.publish',
  'recommendation.update','recommendation.delete','legacy.admin_added','legacy.admin_removed',
  'legacy.character_reference_created','legacy.character_reference_version_created',
  'legacy.editor_pick_removed','legacy.editor_pick_saved')
BEGIN SELECT RAISE(ABORT,'unsupported audit action'); END;

CREATE TRIGGER audit_action_update BEFORE UPDATE OF action ON audit_events
WHEN NEW.action NOT IN ('member.role_change','site.update','project.patch','project.delete',
  'submission.withdraw','submission.cutover_supersede','companion.publish',
  'recommendation.update','recommendation.delete','legacy.admin_added','legacy.admin_removed',
  'legacy.character_reference_created','legacy.character_reference_version_created',
  'legacy.editor_pick_removed','legacy.editor_pick_saved')
BEGIN SELECT RAISE(ABORT,'unsupported audit action'); END;

CREATE TRIGGER download_daily_insert AFTER INSERT ON download_daily_stats
WHEN EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id = NEW.user_id
  WHERE p.id = NEW.project_id AND p.visibility = 'public' AND p.deleted_at IS NULL
    AND p.author_id <> NEW.user_id AND u.role NOT IN ('reviewer','owner'))
BEGIN
  UPDATE projects SET downloads_count = downloads_count + 1 WHERE id = NEW.project_id;
  INSERT INTO project_metrics_daily(day_key,project_id,downloads) VALUES(NEW.day_key,NEW.project_id,1)
  ON CONFLICT(day_key,project_id) DO UPDATE SET downloads = downloads + 1;
END;

CREATE TRIGGER download_daily_update AFTER UPDATE OF count ON download_daily_stats
WHEN NEW.count > OLD.count AND EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id = NEW.user_id
  WHERE p.id = NEW.project_id AND p.visibility = 'public' AND p.deleted_at IS NULL
    AND p.author_id <> NEW.user_id AND u.role NOT IN ('reviewer','owner'))
BEGIN
  UPDATE projects SET downloads_count = downloads_count + NEW.count - OLD.count WHERE id = NEW.project_id;
  INSERT INTO project_metrics_daily(day_key,project_id,downloads) VALUES(NEW.day_key,NEW.project_id,NEW.count-OLD.count)
  ON CONFLICT(day_key,project_id) DO UPDATE SET downloads = downloads + NEW.count - OLD.count;
END;

CREATE TRIGGER project_like_metrics AFTER INSERT ON project_likes
BEGIN
  INSERT INTO project_metrics_daily (day_key, project_id, likes_delta)
  SELECT strftime('%Y-%m-%d', 'now'), NEW.project_id, 1
  WHERE EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id)
  ON CONFLICT(day_key, project_id) DO UPDATE SET likes_delta = likes_delta + 1;
END;

CREATE TRIGGER project_likes_count_delete AFTER DELETE ON project_likes
BEGIN
  UPDATE projects SET likes_count = MAX(likes_count - 1, 0) WHERE id = OLD.project_id;
END;

CREATE TRIGGER project_likes_count_insert AFTER INSERT ON project_likes
BEGIN
  UPDATE projects SET likes_count = likes_count + 1 WHERE id = NEW.project_id;
END;

CREATE TRIGGER project_search_author_update AFTER UPDATE OF global_name,username ON users
WHEN OLD.global_name IS NOT NEW.global_name OR OLD.username IS NOT NEW.username
BEGIN
 UPDATE project_search SET author_name=COALESCE(NEW.global_name,NEW.username)
 WHERE rowid IN(SELECT rowid FROM projects WHERE author_id=NEW.id);
 DELETE FROM project_search_short WHERE rowid IN(SELECT rowid FROM projects WHERE author_id=NEW.id);
 INSERT INTO project_search_short(rowid,spaced_text)
 SELECT project_rowid,spaced_text FROM project_search_short_source
 WHERE project_rowid IN(SELECT rowid FROM projects WHERE author_id=NEW.id);
END;

CREATE TRIGGER project_search_delete
AFTER DELETE ON projects
BEGIN
  DELETE FROM project_search WHERE rowid = OLD.rowid;
  DELETE FROM project_search_short WHERE rowid = OLD.rowid;
  DELETE FROM project_search_tags WHERE project_id = OLD.id;
END;

CREATE TRIGGER project_search_update AFTER UPDATE OF published_version_id,author_id ON projects
BEGIN
 DELETE FROM project_search_tags WHERE project_id=NEW.id;
 INSERT INTO project_search_tags(project_id,tag)
 SELECT NEW.id,j.value FROM "project_versions" r,json_each(r.tags) j
 WHERE r.id=NEW.published_version_id AND j.type='text' AND j.value<>'';
 DELETE FROM project_search WHERE rowid=NEW.rowid;
 INSERT INTO project_search(rowid,title,project_type,included_types,tag_text,author_name)
 SELECT NEW.rowid,r.title,r.project_type,
 COALESCE((SELECT group_concat(value,' ') FROM json_each(r.included_types)),''),
 COALESCE((SELECT group_concat(tag,' ') FROM project_search_tags t WHERE t.project_id=NEW.id),''),
 (SELECT COALESCE(global_name,username) FROM users WHERE id=NEW.author_id)
 FROM "project_versions" r WHERE r.id=NEW.published_version_id;
 DELETE FROM project_search_short WHERE rowid=NEW.rowid;
 INSERT INTO project_search_short(rowid,spaced_text)
 SELECT project_rowid,spaced_text FROM project_search_short_source WHERE project_rowid=NEW.rowid;
END;

CREATE TRIGGER project_search_version_insert AFTER INSERT ON "project_versions"
WHEN EXISTS(SELECT 1 FROM projects WHERE published_version_id=NEW.id)
BEGIN
 UPDATE projects SET published_version_id=published_version_id WHERE published_version_id=NEW.id;
END;

CREATE TRIGGER project_subscriptions_count_delete AFTER DELETE ON project_subscriptions
BEGIN
  UPDATE projects SET subscriptions_count = MAX(subscriptions_count - 1, 0) WHERE id = OLD.project_id;
END;

CREATE TRIGGER project_subscriptions_count_insert AFTER INSERT ON project_subscriptions
BEGIN
  UPDATE projects SET subscriptions_count = subscriptions_count + 1 WHERE id = NEW.project_id;
END;

CREATE TRIGGER project_unlike_metrics AFTER DELETE ON project_likes
BEGIN
  INSERT INTO project_metrics_daily (day_key, project_id, likes_delta)
  SELECT strftime('%Y-%m-%d', 'now'), OLD.project_id, -1
  WHERE EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
  ON CONFLICT(day_key, project_id) DO UPDATE SET likes_delta = likes_delta - 1;
END;
