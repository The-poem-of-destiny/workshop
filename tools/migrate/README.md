# P4 migration tool

This local-only tool turns a directory of legacy JSON/JSONL table exports into a deterministic JSON representation of the new Worker tables. It deliberately has **no default source directory** and never reads `data_backup/` automatically.

## Legacy SQL dump input

`from_d1_sql.py` converts a legacy D1 SQL dump plus its R2 tree into the JSON files this tool reads. It derives `assets.json` from each project row's `cover_image`/`download_url` and hashes the matching local R2 object.

```sh
python3 tools/migrate/from_d1_sql.py data_backup/d1-export.sql data_backup/r2 /tmp/legacy-export
```

Use a disposable directory outside the repository; never commit the dump or generated target.

`load-local.mjs` applies a migrated target to an isolated local D1 state directory (never remote):

```sh
node tools/migrate/load-local.mjs --target /tmp/migration.json --persist-to /tmp/d1-state
```

## Commands

```sh
node tools/migrate/cli.mjs --help
node tools/migrate/cli.mjs all --source ./legacy-export --target ./migration-target.json
node tools/migrate/cli.mjs verify --target ./migration-target.json
node tools/migrate/cli.mjs reconcile --source ./legacy-export --target ./migration-target.json
```

`extract`, `transform`, `load`, `reconcile`, and `all` require `--source`; `verify` only needs `--target`. `--dry-run` performs the phase without writing the target. `--since 2026-01-01T00:00:00Z` filters rows by their update/create/submission timestamp for a delta rehearsal.

The source directory contains one JSON or JSONL file per legacy table (for example `users.json`, `projects.json`, `assets.json`, `project_likes.json`). A JSON file may be an array, `{ "rows": [...] }`, or `{ "items": [...] }`. Unknown filenames are ignored. The accepted legacy aliases include old names such as `project_subscribes`, `project_ratings`, `character_references`, and `devteam_recommendations`.

`all` writes only a local target JSON file. It uses stable ordering and deterministic IDs, so repeating it against an unchanged source produces identical bytes. It keeps the selected published project's public id while grouping published/root/draft rows, maps revisions and assets, preserves decidable interactions/reviews/submissions/recommendations/reference/site rows, and records expected project/published-pointer counts in `meta`.

`verify` checks project and published-pointer counts, revision and project/user foreign keys, duplicate IDs, asset SHA-256 values (and optional `content_base64`), and one pending/checking submission per project. `reconcile` emits JSON containing per-table expected/actual counts and bounded missing/unexpected rows; it exits 1 when any mismatch is present.

The tool is an offline rehearsal skeleton: `load` writes a portable JSON target rather than contacting D1 or R2. A production load adapter must be added only after a real backup export and target-binding runbook are available.

Run the self-contained synthetic tests with:

```sh
node tools/migrate/test.mjs
```
