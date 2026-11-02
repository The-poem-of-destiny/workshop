-- Export exact report bytes, upload and verify with transfer-review-reports.mjs,
-- then apply its receipt SQL before this migration. Missing receipts abort it.
CREATE TABLE IF NOT EXISTS review_report_transfer_receipts (
  source TEXT NOT NULL, source_id TEXT NOT NULL, submission_id TEXT NOT NULL,
  report_hash TEXT NOT NULL, PRIMARY KEY(source,source_id)
);
CREATE TABLE review_report_transfer_guard (ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO review_report_transfer_guard SELECT CASE WHEN
  NOT EXISTS(SELECT 1 FROM submissions s WHERE
    (s.check_report IS NULL) <> (s.check_report_hash IS NULL) OR
    (s.check_report IS NOT NULL AND NOT EXISTS(SELECT 1 FROM review_report_transfer_receipts r
      WHERE r.source='submissions' AND r.source_id=s.id AND r.submission_id=s.id AND r.report_hash=s.check_report_hash)))
  AND NOT EXISTS(SELECT 1 FROM submission_check_runs s WHERE
    (s.report IS NULL) <> (s.report_hash IS NULL) OR
    (s.report IS NOT NULL AND NOT EXISTS(SELECT 1 FROM review_report_transfer_receipts r
      WHERE r.source='submission_check_runs' AND r.source_id=s.id AND r.submission_id=s.submission_id AND r.report_hash=s.report_hash)))
  THEN 1 ELSE 0 END;
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
  CHECK((report_r2_key IS NULL) = (report_hash IS NULL))
);
CREATE INDEX idx_automated_review_queue ON automated_reviews(status,lease_until);
INSERT INTO automated_reviews(submission_id,status,attempts,lease_until,error,client_gate,
  client_checker_version,checker_version,route_gate,report_r2_key,report_hash,duration_ms,checked_at)
SELECT id,check_status,check_attempts,check_lease_until,check_error,COALESCE(client_gate,'missing'),
  client_checker_revision,review_checker_revision,
  CASE WHEN json_valid(check_report) THEN json_extract(check_report,'$.routeGate') END,
  CASE WHEN check_report_hash IS NOT NULL THEN 'reports/'||id||'/'||check_report_hash||'.json' END,
  check_report_hash,(SELECT r.duration_ms FROM submission_check_runs r
    WHERE r.submission_id = submissions.id AND r.report_hash = submissions.check_report_hash
    ORDER BY r.created_at DESC,r.id DESC LIMIT 1),checked_at FROM submissions;
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
INSERT INTO manual_reviews(id,submission_id,reviewer_id,decision,reason,manifest_hash,checker_version,created_at)
SELECT id,submission_id,reviewer_id,decision,reason,manifest_hash,checker_version,created_at FROM reviews;
DROP TABLE reviews;
DROP TABLE submission_check_runs;
DROP INDEX idx_submissions_check_queue;
ALTER TABLE submissions DROP COLUMN client_gate;
ALTER TABLE submissions DROP COLUMN client_checker_revision;
ALTER TABLE submissions DROP COLUMN client_warning_count;
ALTER TABLE submissions DROP COLUMN client_acknowledged_at;
ALTER TABLE submissions DROP COLUMN check_status;
ALTER TABLE submissions DROP COLUMN check_attempts;
ALTER TABLE submissions DROP COLUMN check_lease_until;
ALTER TABLE submissions DROP COLUMN check_report;
ALTER TABLE submissions DROP COLUMN check_report_hash;
ALTER TABLE submissions DROP COLUMN checked_at;
ALTER TABLE submissions DROP COLUMN review_checker_revision;
ALTER TABLE submissions DROP COLUMN check_error;
DROP TABLE review_report_transfer_guard;
DROP TABLE review_report_transfer_receipts;
