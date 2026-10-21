ALTER TABLE oauth_flows ADD COLUMN code_verifier TEXT;
ALTER TABLE oauth_flows ADD COLUMN code_challenge TEXT;
ALTER TABLE oauth_flows ADD COLUMN redeem_hash TEXT;
ALTER TABLE oauth_flows ADD COLUMN guild_id TEXT;
ALTER TABLE oauth_flows ADD COLUMN error TEXT;
ALTER TABLE oauth_flows ADD COLUMN authorized_at TEXT;

CREATE INDEX idx_oauth_flows_state ON oauth_flows(state_hash);
