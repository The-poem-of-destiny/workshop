-- The original-conflict validator resolves a caller-supplied id list against one
-- reference version. `idx_character_reference_items_version_kind` leads with
-- (reference_version_id, kind), so SQLite had to scan every item of the version
-- and filter the id afterwards: on the 2026-11-01 workload that was 556 rows read
-- per call for ~5 returned rows, 35% of the account's daily read quota.
--
-- The picker query is `... WHERE reference_version_id = ? AND kind IN (...) AND
-- id IN (SELECT value FROM json_each(?))`. Ordering the index by
-- (reference_version_id, id) lets the planner turn each requested id into a
-- single seek (`VALUES clause`/`LIST SUBQUERY` still drives the loop, but the
-- inner step becomes `SEARCH ... (reference_version_id=? AND id=?)`).
--
-- Keep this index free of extra trailing columns: a covering variant that leads
-- with `kind` was measured as a net regression because the id is no longer a
-- prefix there, and the planner prefers it for this query.
CREATE INDEX IF NOT EXISTS idx_character_reference_items_version_item
    ON character_reference_items(reference_version_id, id);
