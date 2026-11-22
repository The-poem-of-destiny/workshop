CREATE TABLE public_gallery_replicas (
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('gallery_1', 'gallery_2')),
  asset_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL CHECK (phase IN ('reserving', 'copying', 'ready', 'withdrawing')),
  reservation_etag TEXT,
  PRIMARY KEY (project_id, kind),
  FOREIGN KEY (project_id, asset_id) REFERENCES assets(project_id, id),
  CHECK (phase NOT IN ('copying', 'ready') OR reservation_etag IS NOT NULL)
) STRICT;

CREATE TRIGGER public_gallery_replica_insert_guard
BEFORE INSERT ON public_gallery_replicas
WHEN NOT EXISTS (
  SELECT 1 FROM projects p JOIN assets a ON a.project_id = p.id
  WHERE p.id = NEW.project_id AND p.visibility = 'public' AND p.deleted_at IS NULL
    AND p.published_version_id IS NOT NULL AND a.id = NEW.asset_id
    AND a.kind = NEW.kind AND a.version_id IS NULL
    AND a.mime IN ('image/png', 'image/jpeg', 'image/webp')
)
BEGIN
  SELECT RAISE(ABORT, 'public_gallery_source_ineligible');
END;

-- Gallery slots belong to the project, not to a published version. A change
-- of published version that leaves the project eligible needs no withdrawal.
CREATE TRIGGER public_gallery_replica_project_guard
BEFORE UPDATE OF visibility, deleted_at, published_version_id ON projects
WHEN (NEW.visibility <> 'public' OR NEW.deleted_at IS NOT NULL OR NEW.published_version_id IS NULL)
  AND EXISTS (SELECT 1 FROM public_gallery_replicas WHERE project_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'public_gallery_withdrawal_pending');
END;

CREATE TRIGGER public_gallery_replica_asset_update_guard
BEFORE UPDATE OF id, project_id, version_id, kind, r2_key, sha256, bytes, mime ON assets
WHEN (NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.version_id IS NOT OLD.version_id
  OR NEW.kind IS NOT OLD.kind OR NEW.r2_key IS NOT OLD.r2_key OR NEW.sha256 IS NOT OLD.sha256
  OR NEW.bytes IS NOT OLD.bytes OR NEW.mime IS NOT OLD.mime)
  AND EXISTS (
    SELECT 1 FROM public_gallery_replicas WHERE project_id = OLD.project_id AND kind = OLD.kind AND asset_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'public_gallery_withdrawal_pending');
END;

CREATE TRIGGER public_gallery_replica_asset_delete_guard
BEFORE DELETE ON assets
WHEN EXISTS (
  SELECT 1 FROM public_gallery_replicas WHERE project_id = OLD.project_id AND kind = OLD.kind AND asset_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'public_gallery_withdrawal_pending');
END;
