-- Manifest hashes predate mandatory entry indexing. Only a submission that
-- atomically persists its entire index may mark the index complete.
ALTER TABLE project_revisions
ADD COLUMN entry_index_ready INTEGER NOT NULL DEFAULT 0 CHECK (entry_index_ready IN (0, 1));
