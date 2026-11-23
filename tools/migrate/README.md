# Migration tools

[`offline.py`](offline.py) is the Python CLI entry point, paired with [`full-r2.mjs`](full-r2.mjs) as the sole R2 object transport. Operational procedures, review rules, credential precedence, and authorization gates live in the [legacy data migration runbook](../../docs/operations/legacy-data-migration.md) and [deployment safety runbook](../../docs/operations/deployment-safety.md).

## Subcommand routing

| Entry / subcommand | Implementation | Responsibility |
| --- | --- | --- |
| `offline.py taxonomy {prepare-review,build,verify}` | [`taxonomy.py`](taxonomy.py) | Source-pinned classification/tag review (`current`, `legacy`, or [`preview`](../dev/load-legacy-fixture.config.example.json)), local candidate-v2 build, and independent verification |
| `offline.py prepare` | [`full-transform.py`](full-transform.py), [`full-transform-content.mjs`](full-transform-content.mjs), [`full_transform_history.py`](full_transform_history.py), [`full-load.py`](full-load.py), [`full-validate.py`](full-validate.py), [`multiday-plan.py`](multiday-plan.py) | Legacy SQL/manifest transformation, local byte check, independent source reconciliation, and sealed bounded import planning |
| `offline.py objects {check,upload,verify}` | [`full-r2.mjs`](full-r2.mjs) | Local byte verification and conditional S3 upload/read-back for private snapshot buckets |
| `offline.py public-images {prepare,upload,finalize,withdraw}` | [`public_images.py`](public_images.py), [`full-r2.mjs`](full-r2.mjs) (`public-{check,upload,verify,withdraw}`) | Snapshot public cover/gallery/banner replica planning, conditional upload, `ready.sqlite` / `--replicas-sql` emission, and withdrawn key deletion |
| `offline.py staging {advance,watch,verify,status,adopt}` | [`multiday-staging.py`](multiday-staging.py), [`full-d1-import.py`](full-d1-import.py), [`multiday-budget.py`](multiday-budget.py), [`d1-data.py`](d1-data.py) | Plan-bound staging candidate D1 execution, Free-tier write/read budget accounting, durable receipts, and remote snapshot reconciliation |
| `offline.py preload {advance,verify,status,replicas}` | [`bound_preload.py`](bound_preload.py) | Empty-schema verification, Time Travel bookmark capture, bounded D1 preload, and verified public replica SQL import on an explicit target database |
| `offline.py delta` | [`d1_delta.py`](d1_delta.py) | Self-verified bounded incremental SQL batches and public-image withdrawal manifest between two validated SQLite snapshots |
| `offline.py control {status,close,open,smoke,public-images}` | [`full-staging-control.py`](full-staging-control.py) | Authenticated staging maintenance barrier control, reopened read smoke checks, and online public-image backfill |

Regression suites (`test-*.py`) live beside these modules and are wired into root `pnpm check`.
