# Local public-release migration

This tool consumes an **explicitly provided** legacy export and produces a deterministic local JSON target. It never discovers a default source, contacts remote D1/R2, assigns a legacy privilege, or writes deployment state.

## Exported subset

Only projects satisfying all three legacy conditions are considered:

- `status = 'approved'`
- `is_published = 1`
- `visibility = 1`

For each selected project, the importer retains its public project ID, its existing member author profile (always with role `member`), one published revision, validated current worldbook/regex/cover assets, and a complete persisted `revision_entry_index`. It calculates entry counts, Unicode content lengths, per-entry SHA-256 values, and the canonical manifest hash from the retained assets.

The importer reads only the explicitly named source files `users.json`, `projects.json`, and `assets.json` (or their JSONL/NDJSON equivalents). Each retained asset must include `r2_key`, `sha256`, exact `bytes`, and `content_base64`; the importer verifies the bytes before stripping `content_base64` from the target. Worldbook and regex kinds are explicit source data: a worldbook payload is never reclassified as regex from its filename or shape. Malformed content, hashes, byte counts, duplicate kinds, and missing authors cause the project or optional cover to be skipped with a reason in `meta.skipped`.

Cover destinations are remapped into the served `covers/imported/<sha256>` namespace. `meta.assetSources` records each retained asset's original source key outside the database rows, so the local copy manifest moves the correct bytes to the new key. Shared destination objects are copied once; conflicting hashes or byte counts are rejected.

The target deliberately excludes drafts, unpublished/private/rejected rows, old revisions, submissions, reviews, sessions, administrator roles, likes, subscriptions, ratings, download and ranking counters, social/recommendation data, audit history, reference data, and site configuration.

## Creating a disposable source export

`from_d1_sql.py` reads a legacy D1 SQL dump plus a local mirror of its R2 objects. It writes only the three source files above and embeds local asset bytes for offline verification. Use a disposable directory outside the repository.

```sh
python3 tools/migrate/from_d1_sql.py legacy.sql legacy-r2 /tmp/workshop-public-export
```

## Local commands

```sh
node tools/migrate/cli.mjs all --source /tmp/workshop-public-export --target /tmp/workshop-public-target.json
node tools/migrate/cli.mjs verify --target /tmp/workshop-public-target.json
node tools/migrate/cli.mjs reconcile --source /tmp/workshop-public-export --target /tmp/workshop-public-target.json
node tools/migrate/load-local.mjs --target /tmp/workshop-public-target.json --persist-to /tmp/workshop-d1-state
```

`load-local.mjs` applies the current numbered Worker migrations to an isolated local Wrangler D1 state directory and inserts only the target tables. It has no remote mode.

`r2-copy.mjs` is also local-only: it builds an asset manifest from a target or copies between two local directories while verifying bytes and SHA-256. It has no bucket or remote mode.

```sh
node tools/migrate/r2-copy.mjs --target /tmp/workshop-public-target.json
node tools/migrate/r2-copy.mjs --manifest /tmp/workshop-public-target.json.assets.json --source-dir /tmp/legacy-r2 --target-dir /tmp/target-r2
```

Run the focused local regressions with:

```sh
node tools/migrate/test.mjs
node tools/migrate/test-from-sql.mjs
```
