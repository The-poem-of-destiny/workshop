ALTER TABLE site_settings ADD COLUMN banner_revision TEXT;

CREATE TABLE public_banner_replicas (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source_url TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL CHECK (phase IN ('reserving', 'copying', 'ready', 'withdrawing')),
  reservation_etag TEXT,
  CHECK (phase = 'reserving' OR reservation_etag IS NOT NULL)
) STRICT;

CREATE TRIGGER public_banner_replica_source_guard
BEFORE INSERT ON public_banner_replicas
WHEN NEW.source_url IS NOT (
  SELECT CASE WHEN json_valid(value) THEN json_extract(value, '$.imageUrl') END
  FROM site_settings WHERE key = 'discover_banner'
)
BEGIN
  SELECT RAISE(ABORT, 'public_banner_source_changed');
END;

-- The old source cannot cease to be active while an R2 write or deletion is uncertain.
CREATE TRIGGER public_banner_replica_replace_guard
BEFORE INSERT ON site_settings
WHEN NEW.key = 'discover_banner' AND EXISTS (
  SELECT 1 FROM public_banner_replicas WHERE id = 1 AND source_url IS NOT
    (CASE WHEN json_valid(NEW.value) THEN json_extract(NEW.value, '$.imageUrl') END)
)
BEGIN
  SELECT RAISE(ABORT, 'public_banner_withdrawal_pending');
END;

CREATE TRIGGER public_banner_replica_update_guard
BEFORE UPDATE OF key, value ON site_settings
WHEN OLD.key = 'discover_banner' AND (
  NEW.key IS NOT OLD.key OR
  (CASE WHEN json_valid(NEW.value) THEN json_extract(NEW.value, '$.imageUrl') END) IS NOT
  (CASE WHEN json_valid(OLD.value) THEN json_extract(OLD.value, '$.imageUrl') END)
) AND EXISTS (SELECT 1 FROM public_banner_replicas WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'public_banner_withdrawal_pending');
END;

CREATE TRIGGER public_banner_replica_delete_guard
BEFORE DELETE ON site_settings
WHEN OLD.key = 'discover_banner' AND EXISTS (SELECT 1 FROM public_banner_replicas WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'public_banner_withdrawal_pending');
END;
