CREATE TABLE download_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('worldbook', 'regex')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_download_tokens_expiry ON download_tokens(expires_at);
CREATE INDEX idx_download_tokens_user ON download_tokens(user_id, created_at DESC);
