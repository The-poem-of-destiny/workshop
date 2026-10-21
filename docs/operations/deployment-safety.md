# Deployment Safety

This runbook covers staging and production releases, D1 migration safety, backup, and rollback. It describes the expected route; the workflow files are the executable source.

## Routes

| Change | Route |
|---|---|
| Pull request | `ci` runs `check` and `e2e`; both are required on `main` |
| Merge to `main` | Successful CI builds a complete Worker + Web artifact; staging deploys only changed application code |
| Production | Create a protected `v*` tag on the accepted `main` commit; production environment approval is required |
| Docs/agent/CI-only change | CI runs, staging build/deploy is skipped |
| Backup verification | Manual `verify-production-backup` workflow, read-only |

## Production migration

1. Confirm the tag commit is on `main`, CI passed, and staging deployed that commit successfully.
2. Export `workshop-prod` with `wrangler d1 export --remote`, record its SHA-256, and record the D1 Time Travel bookmark.
3. Upload the SQL, checksum, Time Travel JSON, and manifest to the private backup bucket before applying migrations.
4. Apply only expand-compatible migrations; the previous Worker must remain able to read the schema.
5. Deploy the promoted Worker artifact, record the new Worker version, and run the smoke checks.
6. Keep the previous Worker version and backup object key in the release record.

The production workflow blocks on a missing backup bucket, empty export, failed hash check, or failed staging artifact lookup.

## Rollback

Worker-only failure:

1. Stop further migration/deploy steps.
2. Redeploy the previous Worker version or roll back to its recorded version.
3. Run the same smoke checks.

Schema/data failure:

1. Stop writes or put the service into maintenance mode.
2. Prefer a forward fix when the previous Worker can still read the schema.
3. If data is corrupted, restore the D1 Time Travel bookmark or import the SQL backup into a controlled recovery database.
4. Time Travel restores in place and is destructive; it cannot restore into a separate temporary database.
5. Run integrity and smoke checks before reopening writes.

## Backup verification

The backup workflow downloads an object from the private bucket, verifies an optional SHA-256, runs `PRAGMA integrity_check`, and reports the table count. It does not mutate production D1.

Free-tier limits to keep in mind:

- 500 MB per D1 database
- 7-day Time Travel retention
- 10 GB R2 storage
- 10 D1 databases per account

Retain longer-term SQL backups in R2 with a lifecycle policy; do not rely on Time Travel alone.
