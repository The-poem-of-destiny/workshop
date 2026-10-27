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

Stop/recover: turn the variable off. Startup cleanup still traverses open PR pages and revokes **legacy** `github-actions[bot]` auto-merge grants, even with the switch off; failure to confirm cleanup is fatal. New immediate merges leave no delayed grant. Manual dispatch `recover_pr=<merged same-repository bot PR number>` retries CI only when that merge remains current main, works with the switch off and does not depend on qualification reads. If main advanced, inspect the newer commit's CI instead. Staging failures stop promotion; code rollback does not roll back migrations.

GitHub currently reports no open vulnerability alerts. No real merge request was sent to the temporary probe PR, so a live server-refusal smoke has not been executed. Permission reads, a no-candidate run and synthetic policy/fetch-boundary checks do not prove candidate qualification, a real security merge, dispatch or staging acceptance. Keep those boundaries explicit until a qualifying update occurs.

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
