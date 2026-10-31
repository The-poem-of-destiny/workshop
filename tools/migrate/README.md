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

This is the public-sample importer, not the complete business migration required by [D-40](../../docs/plans/refactor-2026-10/decisions.md#d-40-完整替代旧版与完整数据迁移). Its exclusions must not be treated as permission to discard legacy history during final replacement.

### Implementation boundaries

`lib.mjs` owns extraction, transform orchestration, reconciliation, additive SQL generation, and JSON I/O. `entities.mjs` owns source member/asset lookup maps and project/revision/member row construction; `assets.mjs` owns byte validation, content indexing, asset rows, and canonical manifests. `validation.mjs` owns target verification, retaining the table → expected-project → identity → project/revision → asset → entry-index diagnostic order. Shared deterministic serialization, identifiers, and table names live in `values.mjs`; callers import verification and shared values directly from their owning modules.

## Creating a disposable source export

`from_d1_sql.py` reads a legacy D1 SQL dump plus a local mirror of its R2 objects. It writes only the three source files above and embeds local asset bytes for offline verification. Use a disposable directory outside the repository.

```sh
python3 tools/migrate/from_d1_sql.py legacy.sql legacy-r2 /tmp/workshop-public-export
```

Selection flags `--include-ids`, `--exclude-ids`, `--require-assets`, `--dedupe-name-author`, and `--limit` can narrow that public set. After filtering and deduplication, projects are ordered by ID ascending by default, or by update time descending with `--order updated-desc`, before `--limit` is applied. `selection.json` records dropped projects; narrowing is not a full-migration acceptance result.

## Local commands

```sh
node tools/migrate/cli.mjs all --source /tmp/workshop-public-export --target /tmp/workshop-public-target.json
node tools/migrate/cli.mjs verify --target /tmp/workshop-public-target.json
node tools/migrate/cli.mjs reconcile --source /tmp/workshop-public-export --target /tmp/workshop-public-target.json
node tools/migrate/cli.mjs sql --target /tmp/workshop-public-target.json --out /tmp/workshop-public-import.sql
node tools/migrate/load-local.mjs --target /tmp/workshop-public-target.json --persist-to /tmp/workshop-d1-state
```

`load-local.mjs` applies the current numbered Worker migrations to an isolated local Wrangler D1 state directory and inserts only the target tables. It has no remote mode.

`r2-copy.mjs` is also local-only: it builds an asset manifest from a target or copies between two local directories while verifying bytes and SHA-256. It has no bucket or remote mode.

`import-staging.mjs` is a separate remote operation: default read-only preflight, with mutation gated by `--apply`. Preflight requires explicitly authorized `STAGING_IMPORT_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; apply additionally requires dedicated `STAGING_IMPORT_R2_ACCESS_KEY_ID` and `STAGING_IMPORT_R2_SECRET_ACCESS_KEY` credentials scoped to object read/write in `workshop-client-staging`. It does not read `.env` or derive S3 credentials from the API token. It is fixed to staging D1/R2 resources and captures pre-import evidence. Package SQL must exactly match `migrationSql(target)` before any remote access; execution uses an isolated, fixed copy. Existing R2 objects are reusable only when bytes and SHA-256 match; new objects use atomic S3 `If-None-Match: *`, with a competing creation re-read and compared instead of overwritten. Neither a local check nor permission to merge authorizes invoking it against remote data. This integration does not execute it remotely.

The [official R2 conditional PutObject contract](https://developers.cloudflare.com/r2/api/s3/extensions/#conditional-operations-in-putobject) (updated 2026-10-14) guarantees atomic conditional creation and HTTP 412 on a competing object. Wrangler's installed `r2 object put` command has no conditional flag; a preflight followed by an unconditional upload is not equivalent. [R2 S3 credentials](https://developers.cloudflare.com/r2/api/tokens/) (updated 2026-10-01) use a dedicated access-key ID and secret with bucket-scoped Object Read & Write permission, not the D1 management token. Target and manifest are parsed once; validated SQL and assets are sealed into private isolated copies before remote access, and execution/upload do not reread package originals. Local protocol tests do not establish remote credential permissions or prove a remote migration has run.

```sh
node tools/migrate/r2-copy.mjs --target /tmp/workshop-public-target.json
node tools/migrate/r2-copy.mjs --manifest /tmp/workshop-public-target.json.assets.json --source-dir /tmp/legacy-r2 --target-dir /tmp/target-r2
```

Run the focused local regressions with:

```sh
node tools/migrate/test.mjs
node tools/migrate/test-from-sql.mjs
```
