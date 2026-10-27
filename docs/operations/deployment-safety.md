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

The repository variable `DEPENDENCY_SECURITY_AUTOMERGE` must equal `true` to grant GitHub auto-merge. Absent/other values default to **cleanup-only**, not read-only qualification: after reconciling stranded bot grants, the workflow reports `automerge=disabled` and `qualification=BLOCKED`. A successful cleanup-only run proves cleanup completed, not that merge permissions or policy passed. Manual dispatch input `probe_permissions=true` explicitly runs the real protection/alert probes with merging still disabled; missing permissions fail the workflow. Enabling the merge switch also retains the real probes and failure behavior.

The actual workflow-token smoke [run 40467982092](https://github.com/The-poem-of-destiny/workshop/actions/runs/40467982092) failed with GraphQL `Resource not accessible by integration` at `ref.branchProtectionRule`. Complete branch protection reads require repository **Administration: read**, which is absent from configurable `GITHUB_TOKEN` permissions. The current token therefore cannot qualify updates: keep both the variable and repository auto-merge off. Do not remove protection verification or substitute a personal token. Resolution requires a separately reviewed, single-repository GitHub App installation with Administration read and its own credential; none is currently configured. Repository-setting access alone cannot create an installed App identity or manufacture its signing credential. Official evidence: [App administration permission mapping](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#repository-permissions-for-administration), [additional token permissions](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token#granting-additional-permissions).

Rulesets are not a read-permission workaround: effective rules are readable with Metadata read, but the [ruleset detail API](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset) returns `bypass_actors` only to identities with ruleset write access. An omitted list is not an empty list, and `current_user_can_bypass: never` proves nothing about other administrators. Do not migrate protection solely to hide this verification gap.

Enable only after independent review, resolving the credential prerequisite, an actual workflow-token permissions smoke, and enabling repository auto-merge. The job explicitly requests `vulnerability-alerts: read`; CLI-user API success does not prove this token can inspect alerts. Official scope and event semantics: [workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions), [workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), [Dependabot GraphQL objects](https://docs.github.com/en/graphql/reference/dependabot).

Token-created merges do not automatically trigger push workflows. After a qualifying auto-merge, the policy explicitly dispatches `ci.yml` with the exact merge `expected_sha`. CI rejects malformed SHA, non-main ref, or a SHA different from both its event commit and live `main`; successful CI then reaches the existing staging freshness gate. This does not authorize production tags or deployment.

Stop/recover: turn the variable off and dispatch the policy to reconcile pending bot auto-merge authorizations. Startup cleanup runs even with the switch off, traverses open PR pages, revokes grants attributed to `github-actions[bot]`, and fails if revocation cannot be confirmed. After enabling, read/wait failures still attempt revocation; cleanup errors remain visible. Forced runner termination can still strand a grant until the next run: inspect and manually disable it when urgent. A manual `dependency-security-automerge` dispatch with `recover_pr=<merged same-repository bot PR number>` retries CI only when that merge is still current `main`; it does not merge anything, works with the switch off, and does not depend on alerts/protection queries. If `main` advanced, inspect the newer commit's CI rather than dispatching an old revision. Staging failures stop promotion; code rollback does not roll back migrations.

At initial implementation, GitHub reported no open vulnerability alerts. Synthetic policy checks are not a real security-update-to-staging acceptance; keep that full-chain boundary explicit until a qualifying update occurs.

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
