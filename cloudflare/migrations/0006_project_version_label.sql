-- Separate creator-facing version text from the Workshop-controlled machine version.
ALTER TABLE projects ADD COLUMN version_label TEXT;
