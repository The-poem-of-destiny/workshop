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

## Client artifact publishing

`pnpm --filter @workshop/tavern-client publish:client --env <staging|production> --channel <staging|stable>` writes two objects (`client/v/<sha>/index.js`, `client/<channel>/index.js`) plus the `client_channels` row in D1.

Objects are uploaded through the **R2 S3 endpoint** (`<account>.r2.cloudflarestorage.com`, SigV4, region `auto`), using the API token id as access key and `SHA-256(token)` as secret. Workflow jobs supply `CLOUDFLARE_API_TOKEN`; D1 bookkeeping still uses Wrangler.

Do not switch the object upload back to `wrangler r2 object put`: that command uses the Cloudflare REST API, where bucket-scoped R2 permissions (`Object Read & Write`, `Bucket Item Write`) do not apply, producing `403 Authentication error` even when the bucket permission is configured correctly. Verified by signing the same PUT over S3 against the same bucket.

CI must use its own dedicated token. Never copy a machine-local token into GitHub secrets or repository files.

## Smoke assertions

Download a response before asserting on it (`curl -o file` then `grep`). Piping `curl` into `grep -q` lets `grep` exit early, which surfaces as `curl: (23)` and fails the step under `set -o pipefail`.

## Backup verification

The backup workflow downloads an object from the private bucket, verifies an optional SHA-256, runs `PRAGMA integrity_check`, and reports the table count. It does not mutate production D1.

Free-tier limits to keep in mind:

- 500 MB per D1 database
- 7-day Time Travel retention
- 10 GB R2 storage
- 10 D1 databases per account

Retain longer-term SQL backups in R2 with a lifecycle policy; do not rely on Time Travel alone.
