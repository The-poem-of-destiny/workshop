-- The baseline reference feature is removed, including its cache invalidation
-- triggers. Historical numbered migrations remain immutable.
DROP TRIGGER IF EXISTS bump_cache_epoch_reference_items_insert;
DROP TRIGGER IF EXISTS bump_cache_epoch_reference_items_update;
DROP TRIGGER IF EXISTS bump_cache_epoch_reference_items_delete;
DROP TABLE reference_items;
DROP TABLE reference_versions;
DROP TABLE reference_sets;
