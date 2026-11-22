CREATE TABLE public_cover_replicas (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  object_key TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL CHECK (phase IN ('reserving', 'copying', 'ready', 'withdrawing')),
  reservation_etag TEXT,
  CHECK (phase NOT IN ('copying', 'ready') OR reservation_etag IS NOT NULL)
) STRICT;

-- A writer that bypasses the replica lifecycle must fail closed. The lifecycle
-- removes the row only after R2 confirms deletion; uncertain reservations keep
-- the row and prevent a publication transition from reporting success.
CREATE TRIGGER public_cover_replica_guard
BEFORE UPDATE OF visibility, deleted_at, published_version_id, published_cover_asset_id ON projects
WHEN (
  NEW.visibility IS NOT OLD.visibility OR NEW.deleted_at IS NOT OLD.deleted_at
  OR NEW.published_version_id IS NOT OLD.published_version_id
  OR NEW.published_cover_asset_id IS NOT OLD.published_cover_asset_id
) AND EXISTS (SELECT 1 FROM public_cover_replicas WHERE project_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'public_cover_withdrawal_pending');
END;
