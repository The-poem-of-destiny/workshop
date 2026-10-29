# Deployment Safety

This runbook covers staging and production releases, D1 migration safety, backup, and rollback. It describes the expected route; the workflow files are the executable source.

## Routes

| Change | Route |
|---|---|
| Pull request | `ci` runs `check`, `e2e`, and `secrets`; all three are required on `main`, including administrators |
| Merge to `main` | Successful CI builds a complete Worker + Web artifact; staging deploys only changed application code |
| Production | Create a protected `v*` tag on the accepted `main` commit; production environment approval is required |
| Docs/agent/CI-only change | CI runs, staging build/deploy is skipped |
| Backup verification | Manual `verify-production-backup` workflow, read-only |

## Dependency security updates

Dependabot ordinary version updates remain weekly and grouped; security updates are enabled separately. The `dependency-security-automerge` workflow runs trusted `main` policy only, never checks out or executes PR code, and uses no personal token or new secret.

The pilot allowlist is only the Worker runtime leaf dependency `hono`: a stable, increasing patch within the same minor; exactly the Worker manifest and canonical pnpm leaf lock change; a single verified Dependabot commit based on current `main`; a GitHub open vulnerability alert linked to the exact PR/head, installed old version and exact first patched version. Grouped, ambiguous, unknown, major/minor, Actions, scripts, registry and unrelated lock changes remain manual. Required checks must be successful on the latest head and bound to GitHub Actions app `15368`; strict protection must enforce administrators and disallow bypass, force pushes and deletion.

The repository variable `DEPENDENCY_SECURITY_AUTOMERGE` must equal `true` to perform a qualifying merge. Absent/other values default to **cleanup-only**: reconcile legacy bot auto-merge grants, then report `automerge=disabled` and `qualification=BLOCKED`. A successful cleanup-only run proves cleanup, not qualification. Dispatch input `probe_permissions=true` runs actual protection/alert reads while merging stays disabled; missing visibility fails closed.

Runtime protection reads use public branch check metadata plus GraphQL `refUpdateRule`, the rules **enforced on the viewer**: require protected main, everyone-enforced exact checks with Actions app `15368`, matching viewer contexts, no force/delete and the reviewed zero-approval policy. Additional applicable branch rulesets are rejected pending policy review. Each candidate also requires `viewerCanMergeAsAdmin: false`, `CLEAN`, exact current head/base and successful checks. Ordinary `viewerCanPush: true` is not treated as bypass permission.

Owner-managed baseline remains strict/up-to-date checks, administrator enforcement and no actor bypass. These values are not fully visible to `GITHUB_TOKEN`; runtime does **not** claim complete auditing of other actors or all configuration drift. The owner approved this separation rather than introducing an Administration-reading credential. Keep the baseline unchanged; audit it after protection changes. Full configuration reads were an over-strong implementation prerequisite, not a requirement for ordinary protected merging. [Official GITHUB_TOKEN auto-merge example](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions#enabling-automerge-on-a-pull-request), [viewer-enforced rules](https://docs.github.com/en/graphql/reference/git).

Already-CLEAN PRs use normal `mergePullRequest` with `expectedHeadOid` and squash; this is server-protected merging, not admin bypass. No deferred auto-merge authorization is created. Repository auto-merge can stay off. Original [run 40467982092](https://github.com/The-poem-of-destiny/workshop/actions/runs/40467982092) correctly showed complete configuration reads were forbidden; later [write-token probe 40487964827](https://github.com/The-poem-of-destiny/workshop/actions/runs/40487964827) proved viewer-enforced rules, public metadata and alert reads work without a new identity. Empty alert results do not prove a real alert-to-PR sample.

Token-created merges do not automatically trigger push workflows. After a positively confirmed qualifying merge, the policy explicitly dispatches `ci.yml` with the exact merge `expected_sha`; malformed/stale/non-main dispatches fail. A lost merge response is rechecked, never retried blindly. A failed confirmation or dispatch remains visible for recovery. Successful CI reaches the existing staging freshness gate; this does not authorize production tags or deployment.

Stop/recover: turn the variable off **and cancel active enabled policy runs**; already-running processes retain their injected environment, so changing the variable is not immediate revocation. Cancellation also cannot undo a merge request already accepted by GitHub: inspect PR/main after stopping. Startup cleanup still traverses open PR pages and revokes **legacy** `github-actions[bot]` auto-merge grants, even with the switch off; failure to confirm cleanup is fatal. New immediate merges leave no delayed grant. If cancellation or an error interrupted CI continuation after a merge, manually dispatch `recover_pr=<merged same-repository bot PR number>`; it retries CI only when that merge remains current main, works with the switch off and does not depend on qualification reads. If main advanced, inspect the newer commit's CI instead. Staging failures stop promotion; code rollback does not roll back migrations.

GitHub currently reports no open vulnerability alerts. No real merge request was sent to the temporary probe PR, so a live server-refusal smoke has not been executed. Permission reads, a no-candidate run and synthetic policy/fetch-boundary checks do not prove candidate qualification, a real security merge, dispatch or staging acceptance. Keep those boundaries explicit until a qualifying update occurs.

## Release Decision And Artifact

Before creating a production tag, obtain explicit production authorization, identify the exact commit and its successful staging deployment, and review every pending migration against the currently deployed Worker and rollback target. Confirm the production environment approval, credentials, configuration, backup access, recovery owner and acceptance window. The configured production Discord variables in [`wrangler.jsonc`](../../apps/worker/wrangler.jsonc) are empty; confirm the actual production configuration and login behavior rather than assuming they are ready. Never use a personal token for CI.

The staging build stores Worker, Web and client files, `artifact.sha256` and `artifact-manifest.json` as `release-<source SHA>` for **30 days**. Staging and production run `sha256sum -c artifact.sha256` and compare the manifest's `sourceSha` with the expected commit. `artifactHash` is the SHA-256 of the checksum manifest file, not a hash of the artifact archive; neither workflow compares that field to the checksum file. The checks establish consistency with the downloaded checksum list and source SHA field, not independent provenance or verification of `artifactHash`.

Production looks up a successful `deploy-staging.yml` run for the tag commit and downloads that run's release artifact. A successful run that skipped its build, an expired/deleted artifact, or an unavailable artifact prevents promotion; success of CI alone is insufficient. Do not rebuild a replacement and call it the same promoted artifact. Arrange a fresh eligible staging build and acceptance before promotion, or stop and resolve the release process.

## Production Migration

The workflow does **not** enforce expand compatibility: it applies all pending migrations before deploying the new Worker. For example, [`0021_remove_obsolete_state.sql`](../../apps/worker/migrations/0021_remove_obsolete_state.sql) drops columns, changes publication data and replaces the assets table. A previous Worker may fail or misinterpret data after such a migration. A code-only rollback is permitted only after checking its reads and writes against the resulting schema and data. If compatibility cannot be established, do not approve the automatic release until an authorized, rehearsed recovery and write barrier exist.

1. Record the deployed Worker version, client channel revision, database state, pending migration list, exact tag/commit and successful staging run. Ensure the rollback target and its artifact are available; the first cutover may have no compatible previous application.
2. Establish and verify a write barrier when a consistent recovery point or incompatible migration requires one. There is **no implemented maintenance-mode switch or proven general write barrier** in this repository. An operator must identify and verify controls outside the application for all writers, including scheduled jobs, OAuth, uploads, client publishing, administrative writes and any legacy file-GET accounting. Blocking ordinary HTTP writes alone is not sufficient. If a complete barrier cannot be established, stop; do not pretend that maintenance mode exists.
3. Before authorization, create and independently verify an appropriate backup and recovery point using an approved operator procedure; the repository has no standalone backup workflow. Record its object key, digest, bookmark and times. The production workflow subsequently exports `workshop-prod` to nonempty SQL, computes a SHA-256, requests Time Travel information, and uploads SQL, checksum, Time Travel JSON and manifest to the private `BACKUP_BUCKET` before migrations. Export and bookmark are obtained separately, so do not assume they represent one atomic point while writes continue. The workflow checks command success, not a downloaded-backup hash or a restore, and does not pause for independent verification. The backup upload uses Wrangler's REST path, so client S3 permission success does not prove backup access.
4. Only after compatibility, prior backup and recovery prerequisites are accepted, authorize the tag and production environment. The workflow verifies the artifact, takes its own backup, applies migrations, deploys the Worker, publishes the stable client, records deployment evidence, then runs smoke checks. Record and independently verify the workflow backup afterward. A failure after migration or deployment can leave partially applied state; inspect each completed step rather than assuming automatic rollback. Evidence upload precedes smoke and is retained for 90 days.
5. Compare the deployed Worker and client revision with the release record. Run the workflow smoke assertions and controlled login, project detail, installation and relevant write/review journeys. Check errors, permissions and data integrity against the pre-release record. Reopen writes only after the barrier and recovery owner confirm acceptance.

## Rollback And Recovery

Stop further deploys and identify the last completed workflow step, current schema, Worker version, client channel and backup point. Protect the release evidence and notify the release owner.

- **Worker-only failure:** if the recorded previous Worker is confirmed compatible with the current schema and data, use the authorized Cloudflare deployment rollback procedure to restore that version, reconcile the client channel if needed, and repeat the smoke and affected journey checks. This repository does not provide a tested rollback command or automatic client rollback.
- **Schema or data failure:** keep all writes stopped; prefer a forward fix only when its data effects are understood. Restoring an earlier D1 point discards later writes. Time Travel restores the selected database in place and is destructive; it does not restore into a separate temporary database. SQL import should first be rehearsed in an isolated recovery database, not blindly into production. Exact restore/import, binding cutover and reversal commands are not established by these workflows: obtain and rehearse a platform-specific procedure with an authorized operator before production use.
- **Recovery acceptance:** compare schema and migration state, integrity and table counts, representative business records and relationships, permissions and R2 object references against the recorded baseline; then check health, public reads, authentication, installation and affected writes in a controlled environment. Verify the intended Worker and client channel together before reopening writes. D1 backup alone does not restore R2 objects or later writes; identify and reconcile those separately. Once users have written to a new database, a return to an old database is not lossless without a separately designed and rehearsed reverse migration.

## Client Artifact Publishing

The client build must exist before running `pnpm --filter @workshop/tavern-client publish:client --env <staging|production> --channel <staging|stable>`; production additionally requires `--allow-production` and authorization outside the script. The script defaults both options to `staging`, validates the built `dist/index.js` SHA-256 against `dist/manifest.json`, and allows either valid channel with either environment, so explicitly review the pair.

The actual write order is versioned R2 object `client/v/<sha>/index.js`, then the `site_settings` row with key `client_channels` in D1, then `client/<channel>/index.js`, followed by an optional cache purge. These operations are not atomic: failure after the D1 update can leave metadata pointing to the new revision while the channel object remains old; purge can fail after all writes, or be skipped when its environment variables are missing. Inspect D1, both objects and served bytes before retrying or declaring success. The script reads and rewrites the whole channel JSON, so avoid concurrent publishes. `--dry-run` skips remote writes but still requires the built files, account ID and token environment variables; it does not validate remote permissions.

Objects are uploaded through the **R2 S3 endpoint** (`<account>.r2.cloudflarestorage.com`, SigV4, region `auto`), using the verified API token id as access key and `SHA-256(token)` as secret. Workflow jobs supply `CLOUDFLARE_API_TOKEN`; D1 bookkeeping still uses Wrangler.

Do not switch the object upload back to `wrangler r2 object put`: that command uses the Cloudflare REST API, where bucket-scoped R2 permissions (`Object Read & Write`, `Bucket Item Write`) do not apply, producing `403 Authentication error` even when the bucket permission is configured correctly. Verified by signing the same PUT over S3 against the same bucket.

CI must use its own dedicated token. Never copy a machine-local token into GitHub secrets or repository files.

## Smoke assertions

Download a response before asserting on it (`curl -o file` then `grep`). Piping `curl` into `grep -q` lets `grep` exit early, which surfaces as `curl: (23)` and fails the step under `set -o pipefail`.

## Backup verification

The verification job uses the protected `production` environment, whose configured ref policy permits `v*` tags. Select an existing authorized `v*` tag containing the verification workflow when dispatching it. If none is suitable, arrange an authorized verification path; do not create a new tag merely for verification, because a new `v*` tag also triggers production deployment.

Dispatch [`verify-production-backup`](../../.github/workflows/verify-production-backup.yml) with the backup `object_key` and the expected `sha256` from a trusted release record or manifest. It requires the production environment and downloads the private R2 object without mutating production D1. It checks the hash only when supplied, imports the SQL into a local SQLite database, requires `PRAGMA integrity_check` to return `ok`, and reports table count; zero tables is only a warning. Inspect the run and its 90-day `backup-verification` artifact and compare the count and digest with the release record. A successful run without an expected hash does not establish object identity, and integrity plus table count does not prove business completeness, D1 restore compatibility or R2 recoverability. Rehearse restoration and reconciliation separately before relying on the backup.

Free-tier limits to keep in mind:

- 500 MB per D1 database
- 7-day Time Travel retention
- 10 GB R2 storage
- 10 D1 databases per account

Retain longer-term SQL backups in R2 with a lifecycle policy; do not rely on Time Travel alone.
