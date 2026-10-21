ALTER TABLE submissions ADD COLUMN client_gate TEXT;
ALTER TABLE submissions ADD COLUMN client_checker_revision TEXT;
ALTER TABLE submissions ADD COLUMN client_warning_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN client_acknowledged_at TEXT;
ALTER TABLE submissions ADD COLUMN check_status TEXT NOT NULL DEFAULT 'needs_human'
  CHECK (check_status IN ('queued', 'running', 'done', 'needs_human', 'failed'));
ALTER TABLE submissions ADD COLUMN check_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN check_lease_until TEXT;
ALTER TABLE submissions ADD COLUMN check_report TEXT;
ALTER TABLE submissions ADD COLUMN check_report_hash TEXT;
ALTER TABLE submissions ADD COLUMN checked_at TEXT;
ALTER TABLE submissions ADD COLUMN review_checker_revision TEXT;
ALTER TABLE submissions ADD COLUMN auto_published_at TEXT;
ALTER TABLE submissions ADD COLUMN check_error TEXT;

UPDATE submissions SET client_gate = gate WHERE client_gate IS NULL;
UPDATE submissions SET client_checker_revision = checker_revision WHERE client_checker_revision IS NULL;

CREATE INDEX idx_submissions_check_queue
  ON submissions(check_status, check_lease_until, submitted_at)
  WHERE status = 'checking';
