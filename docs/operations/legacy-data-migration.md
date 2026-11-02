# Legacy data migration

This runbook distinguishes the local public-sample importer from the current published/working snapshot migration. Snapshot migration preserves mappable business data, not reconstructed submission/review/check history, legacy privileges or login credentials. The tools do not authorize cloud operations or production cutover.

## Local public-sample scope

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

This is the public-sample importer, not the complete business migration required by [D-40](../plans/refactor-2026-10/decisions.md#d-40-完整替代旧版与完整数据迁移). Its exclusions must not be treated as permission to discard legacy history during final replacement.

### Implementation boundaries

`lib.mjs` owns extraction, transform orchestration, reconciliation, additive SQL generation, and JSON I/O. `entities.mjs` owns source member/asset lookup maps and project/revision/member row construction; `assets.mjs` owns byte validation, content indexing, asset rows, and canonical manifests. `validation.mjs` owns target verification, retaining the table → expected-project → identity → project/revision → asset → entry-index diagnostic order. Shared deterministic serialization, identifiers, and table names live in `values.mjs`; callers import verification and shared values directly from their owning modules.

## Creating a disposable source export

`from_d1_sql.py` reads a legacy D1 SQL dump plus a local mirror of its R2 objects. It writes only the three source files above and embeds local asset bytes for offline verification. Use a disposable directory outside the repository.

```sh
python3 tools/migrate/from_d1_sql.py legacy.sql legacy-r2 /tmp/workshop-public-export
```

Selection flags `--exclude-ids`, `--require-assets`, `--dedupe-name-author`, `--order updated-desc`, and `--limit` can narrow that public set. `selection.json` records dropped projects; narrowing is not a full-migration acceptance result.

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

## Full snapshot preparation

Preparation files contain private data; keep them outside the repository with restricted permissions. Diagnostics block loading; omissions are listed separately. Keep the source manifest beside its `r2/<bucket>/<key>` mirror: independent reconciliation reads and verifies those original bytes.

```sh
python3 tools/migrate/full-transform.py legacy.sql manifest.json /tmp/workshop-full-preparation.json
python3 tools/migrate/full-load.py source /tmp/workshop-full-preparation.json legacy.sql manifest.json
python3 tools/migrate/full-load.py reconcile /tmp/workshop-full-preparation.json staging.sqlite --source legacy.sql --manifest manifest.json
python3 tools/migrate/full-validate.py /tmp/workshop-full-preparation.json --migrations apps/worker/migrations
node tools/migrate/full-r2.mjs check legacy-snapshot-dir /tmp/workshop-full-preparation.json
```

Source reconciliation requires explicit candidate lists for every source-backed target table, including empty lists. It independently checks published project metadata, tags and Discord links, references, audit records and retained recommendations against the snapshot. Index entries, content counts, readiness, manifest hashes and content exclusions are derived from the original integrity-checked backup bytes, not the candidate's own indexes or omission claims. Missing, extra or changed rows block loading. Staging-owned settings are checked against the preparation but remain preserved by the staging loader.

Only the explicitly reconciled target tables are accepted; authentication sessions, fabricated submission/review state and other extra candidate tables are rejected. Retained projects must remain undeleted. These checks do not elevate old member roles or restore legacy login credentials.

`full-staging-load.py` targets staging only and requires an explicitly injected `STAGING_IMPORT_TOKEN` authorized for staging and `CLOUDFLARE_ACCOUNT_ID`. It loads SQL through the direct D1 REST client below, not Wrangler `--file`. The remaining Wrangler Time Travel command runs with an isolated home and working directory and an allowlisted environment; the loader does not use ambient `.env` files or stored Wrangler credentials. It also requires verified R2 objects, a stopped and drained set of staging writers, and a matching deployed migration chain. Its flags attest to those conditions; they do not establish them. It records a D1 Time Travel bookmark, snapshots tables locally, rehearses replacement and reconciles after loading. The SQLite snapshot is not a proven D1 restore artifact. Keep writers stopped after a failure until recovery is complete. Do not run the loader until the write barrier and its operational controls have been verified.

On a Wrangler nonzero exit, `wrangler-failure.json` in the private artifacts directory records the exit status and useful stdout/stderr, with the injected token, bearer credentials and URLs redacted. These private diagnostics can still contain SQL or application data; do not publish them.

### Durable D1 import receipts

`full-d1-import.py` implements Cloudflare's documented [`init` / upload / `ingest` / `poll` protocol](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/) and validates the live UUID/name using [`GET database`](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/) before import. The accepted targets are the fixed staging UUID `7500b5f6-21a0-4dfd-9e16-0d9a4f9de476` or a database named exactly `workshop-staging-import-rehearsal`; all others are rejected. These official API references were consulted on 2026-11-02; they do not display publication/update dates. Imports block the target database while running. A cached `init` response may already represent an import in progress or completed; the client does not submit another ingest in that case.

```sh
python3 tools/migrate/full-d1-import.py execute --database-id 7500b5f6-21a0-4dfd-9e16-0d9a4f9de476 --file /private/load.sql --artifacts /private/new-import-receipts
python3 tools/migrate/full-d1-import.py status --artifacts /private/new-import-receipts
python3 tools/migrate/full-d1-import.py resume --artifacts /private/new-import-receipts
```

`execute` requires a new directory outside the repository. It seals a private SQL copy and records byte size, MD5 (the upload ETag contract) and SHA-256. The directory is mode 0700, receipt files are mode 0600, writes are flushed to disk, and a process lock prevents concurrent polling through the same journal. Numbered immutable receipts are authoritative; `state.json` is a convenience snapshot that may lag a receipt after interruption. Each network phase has a durable intent receipt before the request and a response receipt afterwards. Actual `at_bookmark` values remain in these private files. Neither the token nor signed upload URLs are persisted. Full remote response envelopes, including messages and the final result, are retained with credentials/URLs redacted; the console summary exposes only resource identity, file hashes, status, numeric statistics and receipt locations, never row contents.

`status` polls once; `resume` polls until a terminal result. Both use only the actual bookmark saved from the API response and never issue `init`, upload or `ingest`. A transport failure during ingest, or an interruption before a response bookmark was durably saved, can leave the outcome unknown. With no saved bookmark the client refuses to guess or resubmit: inspect private receipts and establish the remote outcome manually. Do not rerun the staging loader or start a new import to resolve ambiguity. The loader stores these receipts under its artifacts directory's `d1-import/` child. A recognized terminal API error returns `ok: false`; API codes and HTTP status are public, while detailed sanitized error messages remain private. Resuming polling does not rerun the loader's post-import snapshot/reconciliation; keep staging writers stopped until that reconciliation and recovery requirements are satisfied.

The generated SQL keeps each statement below 100,000 UTF-8 bytes. Oversized text is reconstructed from chunks in a uniquely named ordinary table within the same import before the original row is inserted, so constraints and triggers see the complete value; oversized keys and unsupported values fail closed. The import creates the chunk table before modifying target data without `IF NOT EXISTS`, so a name collision aborts the import, and drops it after use. There is no permanent target schema change on success. A failed or interrupted import may leave the chunk table behind; inspect the retained `load.sql` and establish the remote outcome before recovery or retry. D1 separately limits a string, BLOB or table row to 2,000,000 bytes ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/), updated 2026-10-30); arbitrary-length values cannot be stored in D1 without changing the storage design.

### Complete remote rehearsal

`full-staging-rehearse.py` accepts only the dedicated rehearsal database, never staging itself, and requires it to be empty. Create that database only under explicit staging-operation authorization. It first imports the supplied staging backup and verifies every logical row, then executes the full replacement and independently snapshots/reconciles the result. Schema, protected settings and foreign keys are checked; large-field reconstruction uses the same SQL generator and durable importer as the real replacement. Snapshot reads use row-size-bounded pages and preserve SQLite value types without JavaScript integer conversion.

```sh
python3 tools/migrate/full-staging-rehearse.py \
  --database-id "$REHEARSAL_DATABASE_ID" \
  --preparation /private/preparation.json --before /private/before.sqlite \
  --source /private/legacy.sql --manifest /private/manifest.json \
  --migrations apps/worker/migrations --artifacts /private/new-remote-rehearsal
python3 tools/migrate/test-full-import.py
python3 tools/migrate/test-full-source.py
python3 tools/migrate/test-full-index.py
```

The private artifacts retain both import journals, before/after snapshots, local rehearsal and reconciliation. Keep them through acceptance; delete the isolated cloud database after its terminal import state and verification are established. On any ambiguous response, inspect the corresponding journal and use its status/resume command rather than starting the rehearsal again.

## Staging maintenance and read-only smoke

`full-staging-control.py` is fixed to `https://workshop-staging.poem-of-destiny.workers.dev`; there is no target URL override. Supply the existing local **maintenance** secret with `--token-file`, not a Cloudflare API token or a legacy session token. The file must be a regular non-symlink file owned by the current user with no group/other permissions. The command reads it in memory only, never copies or prints it, rejects redirects, and sends it only to `/api/v1/maintenance`. HTTPS uses the machine's configured proxy when present; no ambient application session or cookie jar is used. It does not read `.env` or stored Wrangler credentials.

```sh
python3 tools/migrate/full-staging-control.py status --token-file /private/maintenance-token
python3 tools/migrate/full-staging-control.py close --token-file /private/maintenance-token
python3 tools/migrate/full-staging-control.py status --token-file /private/maintenance-token
```

`status` sends GET; `close` and `open` send POST with the corresponding action. Closing admission is not a drain confirmation: do not import until a subsequent status reports `closed: true`, `drained: true`, `outstanding_count: 0`, and `outstanding_truncated: false`. Outstanding ticket identifiers, kinds, and timestamps are not printed. A truncated count is only a lower bound. The tool neither clears tickets nor retries or reopens automatically. After import reconciliation and other required acceptance checks, reopen explicitly:

```sh
python3 tools/migrate/full-staging-control.py open --token-file /private/maintenance-token
python3 tools/migrate/full-staging-control.py smoke --token-file /private/maintenance-token --preparation /tmp/workshop-full-preparation.json
```

Smoke requires an already-open barrier and never changes it. Every smoke business request is an anonymous GET: the operator secret is not injected into application routes, and no synthetic login, draft, review, acquisition, ticket, download, like, or counter write is attempted. It checks health bindings; all home sections; site, discovery, and rankings; complete paginated public catalog membership against the preparation; sampled project details and exact persisted entry indexes; short/general search; reference sets; recommendations; sampled migrated public cover lengths and SHA-256 bytes; unauthenticated maintenance/member/admin/preview rejection; private project/index rejection; and denial of private covers and raw content keys through both asset routes. Every known public incomplete index is checked for the expected 404 rather than being misreported as complete. `--samples` defaults to 3 and accepts 1-10. Output contains only fixed diagnostic labels, HTTP/count totals, maintenance state, and coverage gaps, not response bodies, imported identities, titles, keys, or credentials.

Authenticated preview/download bytes and role-specific behavior still require a real normal login, not migration credentials or an auth bypass. Scheduled ranking/discovery rebuilds are not triggered; those feeds may initially be empty. This command is not an offline Worker-runtime rehearsal. A separate local rehearsal can run the normal Worker dev runtime against an isolated imported D1/R2 state, without remote bindings; existing `tools/e2e-local.mjs` is a synthetic-fixture workflow and does not prove that the full imported snapshot works. No local runtime acceptance should be inferred from SQLite reconciliation alone. Existing public response caches can temporarily show pre-import results; smoke fails on mismatched data and does not add a cache-bypass endpoint or silently accept stale content.

