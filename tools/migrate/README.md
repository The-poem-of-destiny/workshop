# Migration tools

Use [`offline.py`](../../docs/operations/legacy-data-migration.md) for local preparation, source reconciliation and separately authorized staging candidate transfer and verification. This procedure does not authorize remote actions or production cutover.

For separately authorized staging admission and public-read checks, use `python3 tools/migrate/offline.py control {status,close,open,smoke} --token-file <private-token-file>`. The token file must be an owner-only regular file containing the maintenance token, not a Cloudflare or legacy token. `smoke` also requires `--preparation <validated-private-preparation>` and staging to be explicitly reopened; `--samples` (1–10, default 3) and `--timeout` (1–300 seconds, default 60) are optional. These actions do not replace the active database, and opening admission or exercising staging requires separate authorization.

The transform retains available business snapshots and historical records, reporting explicit omissions. `full-load.py` independently derives expectations from the original backup and verifies the target; `full-validate.py` checks schema and application integrity. The planner freezes inputs and emits bounded batches; the staging executor records durable receipts and never blindly retries ambiguous imports. `full-r2.mjs` checks original object bytes and conditionally creates staging objects.

`from_d1_sql.py` is retained solely as an independent public-export utility for the backup verification format; it is not a migration acceptance path. Review-report export/transfer helpers remain separate from the snapshot pipeline and are not proof of report retention or cutover readiness.
