-- Conditional HTTP validation no longer consumes a global public cache epoch.
-- Include names retired by earlier migrations so upgraded and fresh databases
-- both remove the complete historical trigger family.
DROP TRIGGER IF EXISTS bump_cache_epoch_projects_insert;
DROP TRIGGER IF EXISTS bump_cache_epoch_projects_update;
DROP TRIGGER IF EXISTS bump_cache_epoch_projects_delete;
DROP TRIGGER IF EXISTS bump_cache_epoch_likes_insert;
DROP TRIGGER IF EXISTS bump_cache_epoch_likes_delete;
DROP TRIGGER IF EXISTS bump_cache_epoch_metrics;
DROP TRIGGER IF EXISTS bump_cache_epoch_metrics_update;
DROP TRIGGER IF EXISTS bump_cache_epoch_discovery_insert;
DROP TRIGGER IF EXISTS bump_cache_epoch_discovery_delete;
DROP TRIGGER IF EXISTS bump_cache_epoch_banner_insert;
DROP TRIGGER IF EXISTS bump_cache_epoch_banner_update;
DROP TRIGGER IF EXISTS bump_cache_epoch_public_site_delete;
DROP TRIGGER IF EXISTS bump_cache_epoch_users_public_update;
DROP TRIGGER IF EXISTS bump_cache_epoch_recommendations_insert;
DROP TRIGGER IF EXISTS bump_cache_epoch_recommendations_update;
DROP TRIGGER IF EXISTS bump_cache_epoch_recommendations_delete;
DROP TRIGGER IF EXISTS bump_cache_epoch_reference_sets_insert;
DROP TRIGGER IF EXISTS bump_cache_epoch_reference_sets_update;
DROP TRIGGER IF EXISTS bump_cache_epoch_reference_sets_delete;
DROP TRIGGER IF EXISTS bump_cache_epoch_reference_versions_insert;
DROP TRIGGER IF EXISTS bump_cache_epoch_reference_versions_update;
DROP TRIGGER IF EXISTS bump_cache_epoch_reference_versions_delete;
DROP TRIGGER IF EXISTS bump_cache_epoch_gallery_insert;
DROP TRIGGER IF EXISTS bump_cache_epoch_gallery_update;
DROP TRIGGER IF EXISTS bump_cache_epoch_gallery_delete;
-- Keep the epoch row for older Workers during deployment and rollback.
