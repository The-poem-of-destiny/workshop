-- Freeze the publication baseline for new submissions and keep a separate
-- mutable cover association for D-30 published display metadata.
ALTER TABLE submissions ADD COLUMN base_published_revision_id TEXT REFERENCES project_revisions(id);
ALTER TABLE projects ADD COLUMN published_cover_asset_id TEXT;
CREATE UNIQUE INDEX idx_assets_one_display_cover
  ON assets(project_id)
  WHERE revision_id IS NULL AND kind = 'cover';

-- Existing unresolved rows have no trustworthy submission-time baseline. Keep
-- them as history, but require a successor submission under the new protocol.
INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
SELECT lower(hex(randomblob(16))), 'submission.cutover_supersede', 'submission', s.id,
       NULL, '{"reason":"publication_baseline_unavailable"}', CURRENT_TIMESTAMP
FROM submissions s
WHERE s.status IN ('pending', 'checking');
UPDATE submissions
SET status = 'superseded', resolved_at = CURRENT_TIMESTAMP
WHERE status IN ('pending', 'checking');
