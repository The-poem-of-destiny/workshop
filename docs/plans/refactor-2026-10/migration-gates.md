# Migration and cutover gates

This file records the gates enforced by `tools/migrate/lib.mjs` and the steps that are intentionally not automated without an authorized target.

## Enforced by `verify()`

- Project and published-pointer counts match the source-derived expectations.
- Every `working_revision_id` / `published_revision_id` belongs to the same project.
- A published revision has at least one worldbook or regex entry after mapping.
- Assets have 64-hex SHA-256 values and match `meta.assetSha256` / embedded bytes.
- Foreign keys for projects, revisions, assets, submissions, reviews, references and audit users.
- Duplicate ids and duplicate R2 keys are rejected.
- At most one pending/checking submission per project.
- `meta.roleConflicts` is empty. Conflicting source roles are never silently resolved by “highest role”; the conflict list must be reviewed.
- `meta.droppedTables` is empty. Source tables with rows that `transform()` does not migrate (`site_settings`, metrics, rankings, discovery exposures) fail verification until an explicit mapping or no-migrate decision exists.

## Delta behavior

`--since` keeps the full project group: project rows, revisions, assets, submissions, reviews and interactions for any changed project survive even if the asset row itself has no timestamp. New assets for a changed project are therefore not lost.

## R2

`tools/migrate/r2-copy.mjs` builds an explicit source→target manifest, verifies bytes/SHA, resumes idempotently, repairs a corrupt target, and supports a remote `--apply` through wrangler. Local rehearsal is tested in `tools/migrate/test.mjs`.

## Not automated without authorization

- Real source/target bucket names and D1 targets.
- Stop-write barrier covering OAuth, file GETs, cron and all write paths.
- Final delta against the barrier, independent D1/R2 read-back reconcile.
- Production cutover, rollback window and read-only retention.
- Q-10 draw data. No draw tables are created or migrated.

These require human authorization and are recorded as BLOCKED in `checklist.md`; a local `verify: ok` is not a cutover approval.
