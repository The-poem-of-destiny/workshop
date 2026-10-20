# P4 migration rehearsal

## Scope

The migration rehearsal is intentionally local and source-directed. It does not read `data_backup/`, call Cloudflare, or mutate D1/R2. A future run supplies an exported directory through `--source`; the target is a portable JSON file through `--target`.

## Phases

1. **extract** reads JSON/JSONL row exports, applies an optional `--since` timestamp, and normalizes table names.
2. **transform** groups legacy published/root/draft project rows, retains the published public id, and maps rows to the tables in `main.md` §7.1 and `apps/worker/migrations/0001_initial.sql`.
3. **load** writes the deterministic local target representation. It is the stand-in for the eventual D1/R2 adapter and is safe to repeat.
4. **verify** checks counts, pointers, SHA-256 values, foreign keys, duplicate ids, and pending-submission uniqueness.
5. **reconcile** compares a fresh transform with the target and emits machine-readable counts/mismatches (exit status 1 for a mismatch).
6. **all** performs transform, local load, verify, and a self-reconcile.

## Runbook

```sh
node tools/migrate/cli.mjs all --source ./legacy-export --target ./migration-target.json
node tools/migrate/cli.mjs all --source ./legacy-export --target ./migration-target-2.json
cmp migration-target.json migration-target-2.json
node tools/migrate/cli.mjs verify --target ./migration-target.json
node tools/migrate/cli.mjs reconcile --source ./legacy-export --target ./migration-target.json
```

For a final delta rehearsal, provide `--since` at the same timestamp used to establish the cutover barrier. Keep the original full target read-only and reconcile the delta into a separately named target until all §7.2 checks pass. The real cutover still requires the stop-write barrier covering file GET counters and OAuth writes, then manual staging and installation smoke checks.

## Real backup rehearsal

`data_backup/d1-export.sql` is a legacy SQLite dump, not per-table JSON. `tools/migrate/from_d1_sql.py` imports it into an in-memory SQLite database, writes one JSON file per table, and generates `assets.json` by hashing the matching files under `data_backup/r2/` (`cover_image` and `download_url` paths). The output goes to a disposable directory outside git.

```sh
rm -rf /tmp/workshop-legacy-export
python3 tools/migrate/from_d1_sql.py data_backup/d1-export.sql data_backup/r2 /tmp/workshop-legacy-export
node tools/migrate/cli.mjs load --source /tmp/workshop-legacy-export --target /tmp/workshop-migration-load.json
node tools/migrate/cli.mjs all --source /tmp/workshop-legacy-export --target /tmp/workshop-migration-a.json
node tools/migrate/cli.mjs all --source /tmp/workshop-legacy-export --target /tmp/workshop-migration-b.json
cmp /tmp/workshop-migration-a.json /tmp/workshop-migration-b.json
node tools/migrate/cli.mjs verify --target /tmp/workshop-migration-a.json
node tools/migrate/cli.mjs reconcile --source /tmp/workshop-legacy-export --target /tmp/workshop-migration-a.json
node tools/migrate/cli.mjs all --source /tmp/workshop-legacy-export --target /tmp/workshop-delta.json --since 2026-09-01T00:00:00Z
node tools/migrate/cli.mjs verify --target /tmp/workshop-delta.json
node tools/migrate/cli.mjs reconcile --source /tmp/workshop-legacy-export --target /tmp/workshop-delta.json --since 2026-09-01T00:00:00Z
```

Rehearsal result (2026-10-21): 2,783 users, 435 projects, 449 revisions, 690 assets, 2,990 likes, 3,477 subscriptions, 1,798 audit events; two full runs were byte-identical; verify and reconcile passed; the `--since 2026-09-01` delta produced 20 projects / 32 revisions / 56 assets / 134 users and also passed. No dump or generated target is tracked.

## Source contract

The exporter should produce one JSON/JSONL file per old table. Arrays and `{rows: [...]}` / `{items: [...]}` envelopes are accepted. Legacy aliases include `project_likes`, `project_subscribes`, `project_ratings`, `character_references`, `character_reference_versions`, `character_reference_items`, and `devteam_recommendations`. Asset rows should include `sha256`, `bytes`, `mime`, and a key/path; if `content_base64` is included, `verify` hashes it as an additional check.

Rows without an unambiguous user, project, revision, submission, or review relationship are not invented as business data; they are omitted from that dependent table and must be investigated in the reconcile report. Role conflicts are resolved conservatively (`owner` > `reviewer` > `member`) for the deterministic rehearsal output. The eventual real run must stop on unresolved permission conflicts as required by the migration decision record.

## Safety and acceptance

There is no default source path and no production binding. `--dry-run` prevents target writes. The synthetic test uses a temporary directory, proves stable repeated output, and mutates an asset hash to prove verify/reconcile failure behavior. Before P5, add a real export adapter, D1/R2 load transaction strategy, and sampled install verification; those operations require human approval and are outside this skeleton.
