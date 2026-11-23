# Deployment Safety

This runbook covers staging and production releases, D1 migration safety, backup, and rollback. It describes the expected route; the workflow files are the executable source.

## Routes

| Change | Route |
|---|---|
| Pull request | `ci` runs `check`, `e2e`, and `secrets`; all three are required on `main`, including administrators |
| Merge to `main` | Successful CI on current `main` builds and deploys application changes to staging. `main` stays open. |
| Production | An authorized `v*` tag on a `main` commit starts a protected release. The job promotes the exact artifact accepted in staging, without rebuilding it. |
| Docs-only change | CI runs; staging normally skips deployment. Missing, expired or interrupted staging evidence can trigger a new release. |
| Backup verification | Manual `verify-production-backup` workflow, read-only |

Staging skips a revision if `main` has moved, including immediately before the live schema check and release. Once a release starts it can finish while new commits land. Staging and production releases each serialize mutations in their own environment. Explicitly dispatch `ci` on current `main` to request a new staging release even with no application diff; normal CI checks and the live schema check still apply.

## Dependency security updates

Dependabot ordinary version updates remain weekly and grouped; security updates are enabled separately. The `dependency-security-automerge` workflow runs trusted `main` policy only, never checks out or executes PR code, and uses no personal token or new secret.

Vitest 5.1.0 uses `@cloudflare/vitest-plugin` ^1.8.2 (including [workers-sdk#16699](https://github.com/cloudflare/workers-sdk/pull/16699) for mock-factory cleanup in Workers), `@cloudflare/workers-types` ^5.20261115.1, and Wrangler ^4.162.0.

The pilot allowlist is only the Worker runtime leaf dependency `hono`: a stable, increasing patch within the same minor; exactly the Worker manifest and canonical pnpm leaf lock change; a single verified Dependabot commit based on current `main`; a GitHub open vulnerability alert linked to the exact PR/head, installed old version and exact first patched version. Grouped, ambiguous, unknown, major/minor, Actions, scripts, registry and unrelated lock changes remain manual. Required checks must be successful on the latest head and bound to GitHub Actions app `15368`; strict protection must enforce administrators and disallow bypass, force pushes and deletion.

The repository variable `DEPENDENCY_SECURITY_AUTOMERGE` must equal `true` to perform a qualifying merge. Absent/other values default to **cleanup-only**: reconcile legacy bot auto-merge grants, then report `automerge=disabled` and `qualification=BLOCKED`. A successful cleanup-only run proves cleanup, not qualification. Dispatch input `probe_permissions=true` runs actual protection/alert reads while merging stays disabled; missing visibility fails closed.

Runtime protection reads use public branch check metadata plus GraphQL `refUpdateRule`, the rules **enforced on the viewer**: require protected main, everyone-enforced exact checks with Actions app `15368`, matching viewer contexts, no force/delete and the reviewed zero-approval policy. Additional applicable branch rulesets are rejected pending policy review. Each candidate also requires `viewerCanMergeAsAdmin: false`, `CLEAN`, exact current head/base and successful checks. Ordinary `viewerCanPush: true` is not treated as bypass permission.

Owner-managed baseline remains strict/up-to-date checks, administrator enforcement and no actor bypass. These values are not fully visible to `GITHUB_TOKEN`; runtime does **not** claim complete auditing of other actors or all configuration drift. The owner approved this separation rather than introducing an Administration-reading credential. Keep the baseline unchanged; audit it after protection changes. Full configuration reads were an over-strong implementation prerequisite, not a requirement for ordinary protected merging. [Official GITHUB_TOKEN auto-merge example](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions#enabling-automerge-on-a-pull-request), [viewer-enforced rules](https://docs.github.com/en/graphql/reference/git).

Already-CLEAN PRs use normal `mergePullRequest` with `expectedHeadOid` and squash; this is server-protected merging, not admin bypass. No deferred auto-merge authorization is created. Repository auto-merge can stay off. Original [run 40467982092](https://github.com/The-poem-of-destiny/workshop/actions/runs/40467982092) correctly showed complete configuration reads were forbidden; later [write-token probe 40487964827](https://github.com/The-poem-of-destiny/workshop/actions/runs/40487964827) proved viewer-enforced rules, public metadata and alert reads work without a new identity. Empty alert results do not prove a real alert-to-PR sample.

Token-created merges do not automatically trigger push workflows. After a positively confirmed qualifying merge, the policy explicitly dispatches `ci.yml` with the exact merge `expected_sha`; malformed/stale/non-main dispatches fail. A lost merge response is rechecked, never retried blindly. A failed confirmation or dispatch remains visible for recovery. Successful CI reaches the existing staging freshness gate; this does not authorize production tags or deployment.

Stop/recover: turn the variable off **and cancel active enabled policy runs**; already-running processes retain their injected environment, so changing the variable is not immediate revocation. Cancellation also cannot undo a merge request already accepted by GitHub: inspect PR/main after stopping. Startup cleanup still traverses open PR pages and revokes **legacy** `github-actions[bot]` auto-merge grants, even with the switch off; failure to confirm cleanup is fatal. New immediate merges leave no delayed grant. If cancellation or an error interrupted CI continuation after a merge, manually dispatch `recover_pr=<merged same-repository bot PR number>`; it retries CI only when that merge remains current main, works with the switch off and does not depend on qualification reads. If main advanced, inspect the newer commit's CI instead. Staging failures stop promotion; code rollback does not roll back migrations.

GitHub currently reports no open vulnerability alerts. No real merge request was sent to the temporary probe PR, so a live server-refusal smoke has not been executed. Permission reads, a no-candidate run and synthetic policy/fetch-boundary checks do not prove candidate qualification, a real security merge, dispatch or staging acceptance. Keep those boundaries explicit until a qualifying update occurs.

## Release Decision And Artifact

Select an exact commit on `main` with a successful staging deployment. `main` can keep moving while production approval is pending; the tag pins the release. Before creating the authorized tag, review the target bindings, runtime configuration (including the production Discord application ID and guilds in [`wrangler.jsonc`](../../apps/worker/wrangler.jsonc)), migration compatibility, recovery owner and acceptance window. Configure the dedicated CI token and Worker runtime secrets separately; neither release rotates secrets. Production checks the required runtime secret names but cannot verify their values or the Discord journey.

Staging retains Worker, Web and client files, `artifact.sha256` and `artifact-manifest.json` as `release-<source SHA>` for **30 days**. Successful deployment, client publication, smoke and verification of 100% Worker traffic produce `staging-evidence-<source SHA>-<attempt>` for **90 days**. `artifactHash` is the SHA-256 of the checksum manifest file, not a hash of the artifact archive.

Production resolves the tag against the source recorded by the successful staging deploy job, not the staging workflow's own `head_sha`. It verifies the retained files against the checksum manifest and the staging acceptance record. A green CI run, a skipped deployment or an expired artifact is not sufficient. If the selected artifact is unavailable, accept a fresh current-`main` artifact in staging before tagging that revision.

Before mutating production, the job verifies the live target schema and records the current D1 Time Travel bookmark, Worker traffic allocation and client channel records in a 90-day `production-recovery` artifact. The bookmark still expires under D1's own retention period; this is not an R2 backup. The job then deploys the accepted bundle, publishes the stable client, runs smoke and records the active production version. A failure after deployment or publication can leave the release partially live: inspect the recorded recovery point and actual state before retrying.

## Schema Evolution And Production Cutover

[`0001_initial.sql`](../../apps/worker/migrations/0001_initial.sql) is the launch baseline for empty databases, including all three public image replica tables. Existing staging and production databases with the equivalent schema do not need to replay it. Apply future missing migrations or prepare a target from a current snapshot separately, with authorization.

Both workflows compare the target D1's actual tables, indexes, views and triggers with the exact migration chain from the selected commit. They never apply migrations or change bindings to work around a mismatch. If schema differs, inspect the reported objects and target binding, apply the authorized data change separately, then retry. The schema check does not reconcile data or prove a snapshot is safe to switch to.

A routine code-only release on compatible data does not require stopping writes. Use the following steps for a real data or binding cutover, not as a release freeze:

1. Record the currently deployed Worker, client channel revision, source D1/R2, target bindings and exact release. Keep the original source available; confirm who can stop or reopen writes and whether the previous Worker can use the target schema.
2. If writes can change the source during snapshot or cutover, close and drain the maintenance barrier and stop external writers separately. The barrier cannot stop direct D1/R2 writes, client publishing, other Workers or operator tools.
3. Capture a current D1 export or Time Travel bookmark and retain the original R2 objects before changing bindings. Check that the recovery point exists and record its identifiers. Check the candidate schema and integrity; compare key counts and sample records and referenced objects. Do not cut over on a known unexplained mismatch or an incomplete snapshot.
4. Switch only to the authorized target and release. Before reopening writes, verify the actual Worker and client revisions, health, the affected reads, sample permissions and referenced R2 bytes. Once those pass, reopen the barrier and check representative writes before resuming external writers. Stop on data loss, privacy, or access failures; fix non-blocking defects forward. A full restore rehearsal and exhaustive independent reconciliation are not prerequisites for this initial cutover.

## Maintenance Barrier

The Worker exposes `/api/v1/maintenance` for a dedicated operator credential, configured as the `MAINTENANCE_TOKEN` Worker secret independently for each environment. Use a high-entropy secret and protect it as a privileged credential. The endpoint accepts `Authorization: Bearer <secret>`; it does not accept ordinary user sessions. A missing secret denies access. Do not place the secret in source control, URLs, shell history, logs, or CI credentials intended for other purposes.

After deploying and verifying the barrier on the target Worker, send an authenticated `POST` with JSON `{"action":"close"}`. Verify it with a separate authenticated `GET`: `closed` and `drained` must both be true, `outstanding` must be empty, and `outstandingTruncated` must be false. The migration tool's `control status --require-drained` enforces this check. Write-capable requests, their background jobs, scheduled jobs and detached content jobs are tracked; D1 and R2 mutations have separate guards. Verified pure reads bypass the coordinator, and response streaming is not counted as write work. Closure can interrupt work already admitted, so reconcile incomplete business operations before reopening.

A rejected or interrupted storage operation, an interrupted admitted operation, or an ambiguous coordinator response can leave an outstanding ticket permanently. This is intentional: do not infer completion from elapsed time, restart the coordinator, delete its state, or proceed with a migration on an undrained barrier. Investigate and establish a separately authorized recovery procedure. Coordinator failures and unavailable bindings block admission; a failed status request is not evidence of drain.

Before using the result, independently stop external D1/R2 writers, including client publishing and migration tools, and establish that no older Worker versions without this barrier can still write. The barrier cannot protect writes by external tools or code that bypasses the guarded Worker. Recheck `closed` and `drained` immediately before taking the recovery point or changing data, and maintain exclusive operator control throughout the migration. The existing release workflows do not close or verify this barrier automatically.

After recovery acceptance and reconciliation, send authenticated `POST` JSON `{"action":"open"}`. Reopening is rejected while any ticket remains. Verify the response and restore external writers only after the intended Worker and data have been accepted.

## Staging public image backfill

The target public image buckets are `workshop-img-staging` and `workshop-img-prod`. When replacing an existing bucket, drain image writers, verify the currently referenced keys and bytes in the new bucket, then switch the custom domain and Worker binding before reopening writes. Keep the old bucket unexposed until rollback is no longer needed.

Apply only missing additive image migrations to the existing staging D1; never replay the initial schema against an already populated database. Deploy the matching Worker with the staging public image bucket and `PUBLIC_ASSETS_BASE_URL`. With the maintenance barrier open, use `offline.py control public-images --token-file FILE --project-id ID` (repeat IDs) and `--banner` for the current banner. The token file must be private. The authenticated endpoint backfills one project or banner per request, reads only current public sources, and returns replica phases. Check non-ready results before reporting completion; a missing phase is normal only when no eligible image exists. Do not remove a `reserving` row based on elapsed time: an unconditional R2 reservation can still be in flight.

Verify anonymous DTOs and image bytes at the public CDN. Projects without a ready replica keep the authorized Worker URL. On withdrawal the origin is deleted before the business update; cached successful bytes may remain for the configured edge TTL. Never unbind or roll back to a Worker that does not withdraw images while replica rows still exist.

## Rollback And Recovery

Stop further deploys and identify the last completed workflow step, current schema, Worker version, client channel and backup point. Protect the release evidence and notify the release owner.

- **Worker-only failure:** if the recorded previous Worker is confirmed compatible with the current schema and data, use the authorized Cloudflare deployment rollback procedure to restore that version, reconcile the client channel if needed, and repeat the smoke and affected journey checks. This repository does not provide a tested rollback command or automatic client rollback.
- **Schema or data failure:** stop writes if data may be damaged or exposed. Prefer a forward fix when its data effects are understood. Otherwise identify the usable recovery point and confirm the loss window before an authorized restore or binding reversal. Time Travel restores in place and discards later writes. Do not blindly import into production; use an isolated restore if needed to verify a recovery point or procedure you intend to use.
- **Recovery acceptance:** verify the resulting schema, intended Worker and client channel, representative records and R2 references, and affected user paths before reopening. A D1 restore does not restore R2, and switching back to the source after new target writes does not preserve those writes by itself.

## Client Artifact Publishing

The client build must exist before running `pnpm --filter @workshop/tavern-client publish:client --env <staging|production> --channel <staging|stable>`; production additionally requires `--allow-production` and authorization outside the script. The script defaults both options to `staging`, validates the built `dist/index.js` SHA-256 against `dist/manifest.json`, and allows either valid channel with either environment, so explicitly review the pair.

The actual write order is versioned R2 object `client/v/<sha>/index.js` in both the private bucket (`R2`) and public bucket (`PUBLIC_COVERS` with immutable caching), then the `site_settings` row with key `client_channels` in D1, then `client/<channel>/index.js` in both the private bucket and public bucket (`public, max-age=300`). These operations are not atomic: failure after the D1 update can leave metadata pointing to the new revision while one or both channel objects remain old. Inspect D1, both buckets' objects and served bytes before retrying or declaring success. The script reads and rewrites the whole channel JSON, so avoid concurrent publishes. `--dry-run` skips remote writes but still requires the built files, account ID and token environment variables; it does not validate remote permissions.

Objects are uploaded through the **R2 S3 endpoint** (`<account>.r2.cloudflarestorage.com`, SigV4, region `auto`), using the verified API token id as access key and `SHA-256(token)` as secret. Workflow jobs supply `CLOUDFLARE_API_TOKEN`; D1 bookkeeping still uses Wrangler.

Do not switch the object upload back to `wrangler r2 object put`: that command uses the Cloudflare REST API, where bucket-scoped R2 permissions (`Object Read & Write`, `Bucket Item Write`) do not apply, producing `403 Authentication error` even when the bucket permission is configured correctly. Verified by signing the same PUT over S3 against the same bucket.

CI must use its own dedicated token. Never copy a machine-local token into GitHub secrets or repository files.

## Smoke assertions

Download a response before asserting on it (`curl -o file` then `grep`). Piping `curl` into `grep -q` lets `grep` exit early, which surfaces as `curl: (23)` and fails the step under `set -o pipefail`.

Both environments check health, the public catalog, anonymous `/me` rejection and exact served Web entrypoint and client bytes. They separately compare `/api/v1/client/version` against the expected channel and build manifest. Matching bytes do not prove matching D1 metadata, and public smoke does not prove OAuth or authorized writes.

## Backup verification

The verification job uses the protected `production` environment, whose configured ref policy permits `v*` tags. Select an existing authorized `v*` tag containing the verification workflow when dispatching it. If none is suitable, arrange an authorized verification path; do not create a release tag merely for verification.

Dispatch [`verify-production-backup`](../../.github/workflows/verify-production-backup.yml) with the backup `object_key` and the expected `sha256` from a trusted release record or manifest. It requires the production environment, scopes Cloudflare credentials to the private R2 download step only, and never mutates production D1. When `sha256` is supplied, it validates the 64-hex digest format and verifies the downloaded file hash; it then replays the SQL in Python `sqlite3` with `SQLITE_ATTACH`/`SQLITE_DETACH` denied (without executing sqlite3 CLI dot-commands), requires `PRAGMA integrity_check` to return `ok` and `PRAGMA foreign_key_check` to return zero violations, and fails closed if the database has zero tables or is missing core tables (`users`, `projects`, `project_versions`, `assets`). Inspect the run and its 90-day `backup-verification` artifact and compare the count and digest with the release record. A successful run without an expected hash does not establish object identity, and SQLite integrity plus core-table presence does not prove full business completeness, D1 restore compatibility or R2 recoverability. Rehearse restoration and reconciliation separately before relying on the backup.

Free-tier limits to keep in mind:

- 500 MB per D1 database
- 7-day Time Travel retention
- 10 GB R2 storage
- 10 D1 databases per account

Retain longer-term SQL backups in R2 with a lifecycle policy; do not rely on Time Travel alone.
