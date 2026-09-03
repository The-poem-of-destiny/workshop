-- Track draft revisions so reviewers cannot approve stale content.
ALTER TABLE projects ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 1;
