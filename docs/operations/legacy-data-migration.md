# Legacy data migration

The offline pipeline prepares a full available snapshot, not an upgrade of an existing database. It retains mappable current and historical business records and content; it does not fabricate submission, review or check history, old privileges or login credentials. Omissions and diagnostics must be reviewed. The immutable source backup remains the authority. This runbook does not authorize Cloudflare operations, binding changes or production cutover.

## Prepare locally

Keep the backup manifest beside the original `r2/<bucket>/<key>` mirror. Place all generated artifacts under the root project's `.local/tasks/multiday-staging-migration/`; preparation, reports and SQLite snapshots contain private data. Neither the preparation file nor output plan directory may exist yet. Select the actual SQL dump and manifest from the backup, not a sample export.

```sh
umask 077
python3 tools/migrate/offline.py prepare \
  --source data_backup/legacy-20261028T130040Z/d1/creative_workshop.sql \
  --manifest data_backup/legacy-20261028T130040Z/manifest.json \
  --migrations apps/worker/migrations \
  --preparation .local/tasks/multiday-staging-migration/preparation.json --output .local/tasks/multiday-staging-migration/plan
```

The command transforms all records, verifies referenced source object bytes and hashes, independently reconciles raw source against candidate rows and exclusions, validates schema and application integrity, and creates sealed bounded SQL batches, an expected SQLite snapshot and source-check evidence. It fails closed on diagnostics, mismatches or changed inputs. Review `source-check.json`, preparation omissions, inventory and plan before any import. A published revision with invalid omitted content is accepted only for a private project under the narrowly verified incomplete-content exception; duplicate-key content has its own independently verified exception. Source site settings are imported, not silently replaced by staging settings.

## Authorized staging candidate only

Separate explicit authorization is required before any remote operation. Supply a dedicated staging-scoped `STAGING_IMPORT_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for D1; object transfer requires separate bucket-scoped `STAGING_IMPORT_R2_ACCESS_KEY_ID` and `STAGING_IMPORT_R2_SECRET_ACCESS_KEY`. The tools do not read `.env` or use `CLOUDFLARE_API_TOKEN` automatically. Verify the account and `workshop-client-staging` bucket before invoking commands. Object upload uses conditional creation, verifies size and SHA-256 before and after transfer, and fails on conflicting existing objects; rerunning is safe for matching objects. `check` is local only.

```sh
python3 tools/migrate/offline.py objects check --backup data_backup/legacy-20261028T130040Z --preparation .local/tasks/multiday-staging-migration/plan/preparation.json
python3 tools/migrate/offline.py objects upload --backup data_backup/legacy-20261028T130040Z --preparation .local/tasks/multiday-staging-migration/plan/preparation.json
python3 tools/migrate/offline.py objects verify --backup data_backup/legacy-20261028T130040Z --preparation .local/tasks/multiday-staging-migration/plan/preparation.json
python3 tools/migrate/offline.py staging advance --plan .local/tasks/multiday-staging-migration/plan/plan.json --state-dir .local/tasks/multiday-staging-migration/state --confirm-staging
python3 tools/migrate/offline.py staging status --plan .local/tasks/multiday-staging-migration/plan/plan.json --state-dir .local/tasks/multiday-staging-migration/state
```

Advance operates on a new plan-named candidate database, never the active staging database. The private state directory stores account identity, candidate identity, budget reservations, import receipts and bookmarks. Preserve it and the sealed plan unchanged across restarts. Each invocation advances at most ten batches by default (`--max-batches` accepts 1–100). Exit 75 means more work or an account-budget wait; resume with the same command and state. `watch` waits and resumes automatically. An ambiguous ingestion is never blindly resubmitted: only a saved bookmark can be polled; preserve evidence and investigate unresolved or failed states rather than deleting receipts or restarting. Do not share account budget with uncontrolled writers during an import.

For a new plan on the same account, carry every known prior migration ledger before its first write, including abandoned candidates and unresolved reservations. Supply each independent prior state exactly once when creating the new state; omit `--prior-state` on all later invocations:

```sh
python3 tools/migrate/offline.py staging advance --plan .local/tasks/multiday-staging-migration/plan/plan.json --state-dir .local/tasks/multiday-staging-migration/state --prior-state /absolute/path/to/prior/staging-state --confirm-staging
```

Repeat `--prior-state` for independent histories. If a prior state already carries another, supply only the descendant; overlapping provenance is rejected. The initialized receipt records source paths, plan identities and receipt hashes; the source account and ledger must be verifiable. Do not run prior and new candidates concurrently or modify prior journals after carrying them: this is a snapshot, not an account-wide lock. Missing, unknown or external writers cannot be inferred from delayed analytics. Unknown reservations remain charged. If an actual import receipt exceeds its reservation, the full actual charge is recorded and execution fails before further writes; investigate rather than replaying.

### Actual-use daily budget

The admission target is the account's D1 Free allowance: 100,000 written rows and 5,000,000 read rows per UTC day, not an additional 50,000-row migration allowance or 70,000-row account cap. These are the [published D1 pricing limits](https://developers.cloudflare.com/d1/platform/pricing/); they do not prove this account's subscription tier. No paid overage is authorized. Complete atomic batches may leave unused capacity; do not manufacture writes to consume it.

For ordinary inserts, estimate the row plus affected indexes rather than multiplying by a speculative B-tree factor. Successful authoritative import receipts calibrate reservations by phase and data-row count, with 25% headroom and a minimum reservation. Unobserved FTS, schema and chunk operations retain a conservative fallback until suitable observations exist. Estimates are admission forecasts, not guaranteed billing bounds. Keep the actual write count and reservation in the durable journal; missing accounting or an overrun stops further writes.

Account accounting combines a persisted day's observed baseline with the larger of subsequent observed account growth and locally charged migration writes, avoiding wholesale double-counting of receipts already visible in analytics. Legacy ledgers without a baseline are adopted conservatively. Delayed analytics cannot reveal concurrent external writes immediately: stop uncontrolled writers and preserve unknown reservations. Refresh account analytics before each admission. A reset does not refund an operation whose execution day is uncertain.

### Continuing a sealed plan after a policy correction

Do not regenerate SQL, recreate the candidate or replay completed batches to change admission algorithms. With no pending operation or failed state, explicitly adopt the corrected executor:

```sh
python3 tools/migrate/offline.py staging adopt --plan .local/tasks/multiday-staging-migration/plan/plan.json --state-dir .local/tasks/multiday-staging-migration/state --confirm-staging
```

Adoption preserves the original plan bytes and candidate. It verifies the original utility files still match their seals, allows changes only to the planner/executor/budget policy utilities, and pins the replacement utilities, immutable SQL/data inputs, checkpoint receipt and completed receipt hashes. Resume from the corrected checkout with the same plan and state; retain the original checkout needed to validate the old seals. Changed SQL, missing completion evidence, a changed authorized utility or an unresolved operation fails closed. Receipt-derived phase costs are persisted and checked again on each continuation. Adoption is a local authorization record, not a database mutation or an assertion that partially imported data has passed final reconciliation.

After all batches, the executor snapshots the actual candidate, independently reconciles source and target rows, compares schema and search indexes and writes verification evidence. Repeat explicitly if necessary:

```sh
python3 tools/migrate/offline.py staging verify --plan .local/tasks/multiday-staging-migration/plan/plan.json --state-dir .local/tasks/multiday-staging-migration/state --confirm-staging
```

A verified candidate is not automatically activated. Independently verify R2, application behavior, access controls and the operational cutover and rollback plan before any separately authorized binding change. The old public-sample importer is not an acceptance path. Backup export utility `from_d1_sql.py` remains available for its independent verification format.

## Production preparation and acceptance gates

The current remote CLI is staging-only. Do not rename a staging token, bypass target checks or substitute a production database ID to reuse it. Production execution requires a separately authorized, explicitly production-targeted entry point with equivalent identity, journal, quota and no-replay protections. Reuse the offline transformation, sealed-plan construction, receipt accounting and independent reconciliation rather than copying task-local recovery scripts into production.

Before authorizing production writes:

1. Inventory every Worker binding, scheduled writer and other account writer. Close admission and stop scheduled work before draining. A closed status alone is insufficient: exercise the actual admission path and confirm it rejects new tickets. Reconcile abandoned tickets only through a separately reviewed recovery procedure; an empty ticket set is not proof that uncertain historical operations never wrote.
2. Capture and verify a fresh production source backup and object manifest. Review exclusions and source-to-target reconciliation. Do not reuse a staging checkpoint, candidate, maintenance password or stale snapshot for production. Freeze the authorized utility checkout and retain the original sealed utilities across any explicit policy adoption.
3. Confirm the account's actual plan and current UTC-day usage. Ordinary index billing and FTS internal writes differ; use receipt-backed phase calibration, not a global bytes-to-writes multiplier. Account analytics lag, and the migration journal is not a lock on unrelated account writers. Preserve their usage in the budget and preserve unresolved charges.
4. Use a new, positively identified candidate and a private durable journal. Retrying transport must never mean replaying an unknown D1 ingest. Exit 75 alone does not identify quota exhaustion: inspect the phase, checkpoint and budget reason; a command batch bound can be continued immediately when admission still permits it.
5. Transfer objects with conditional creation and byte/SHA-256 verification. On interruption, resume matching objects instead of clearing the bucket again. Verify the entire final key set for both missing and unexpected objects; per-object success alone cannot detect extra objects. Bound transfer concurrency and diagnose direct versus proxy transport separately from application failures.
6. Require full remote/source/schema/search reconciliation, not just counts, foreign-key checks or `quick_check`. Validate actual application permissions, private/public reads, downloads and controlled writes against the candidate before acceptance. Retain exact verification evidence and any historical uncertainty.
7. Check every target binding against the verified candidate immediately before deployment. Deploy the real application with admission still closed and cron disabled; verify client/checker artifacts and maintenance authentication. Only reopen admission and restore cron after acceptance. Keep the old target and a documented binding rollback until rollback retirement is separately approved; do not use staging's authorized destructive reset as a production procedure.

Keep raw migration receipts, private snapshots, transport evidence and recovery records in the task's private runtime directory. Record portable invariants in tools and regression tests; never put credentials, private source data or machine-specific recovery state in this runbook.
