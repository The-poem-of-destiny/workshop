CREATE TABLE submission_check_runs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  review_checker_revision TEXT NOT NULL,
  route_gate TEXT NOT NULL CHECK (route_gate IN ('pass', 'warn', 'block')),
  report TEXT NOT NULL,
  report_hash TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_submission_check_runs_submission
  ON submission_check_runs(submission_id, created_at DESC);
