-- The review queue pages by (status, submitted_at, id) descending.
CREATE INDEX idx_submissions_status_cursor ON submissions(status, submitted_at, id);
