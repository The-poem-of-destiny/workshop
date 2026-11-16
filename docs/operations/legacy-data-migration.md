# Legacy data migration

Two local source paths share the `tools/migrate/offline.py` CLI. The original **legacy backup** path prepares a full available snapshot with explicit omissions; it does not upgrade an existing stage or fabricate missing submission/review/check history, old privileges or login credentials. The **current-snapshot taxonomy** path copies an existing stage's business rows into the final schema, retaining additions made since the legacy import. Never replace the latter with a fresh transformation of the older legacy backup. The immutable source remains the authority. This runbook does not authorize remote reads/writes, object uploads, binding changes or production cutover.

## Review classifications locally

Use a frozen local SQL dump or standalone SQLite backup, not a live database with WAL/SHM/journal sidecars. Keep the original bytes unchanged. A later snapshot requires a new review and candidate; a review cannot authorize changes made after its snapshot. Generated artifacts contain private titles, descriptions, tags, removed fields and account/history data. Keep them in the original project's ignored `.local/` directory with directories `0700` and files `0600`. Review/output files and candidate directories must not already exist.

Run the commands below from the root of the source checkout whose tools/schema you intend to use, including when that checkout is a worktree. Set `ROOT` to the absolute original-project root that owns the approved Python environment and private artifacts, not to the worktree. Use that interpreter explicitly; do not assume a worktree has its own `.local/python/`. Ordinary CLI paths are relative to the command's working directory, not the script or review file. These examples use absolute data/output paths to avoid ambiguity:

```sh
ROOT=/absolute/path/to/original-project-root
PYTHON="$ROOT/.local/python/.venv/bin/python"
```

`taxonomy prepare-review` creates a source-fingerprint-pinned JSON decision file for every source version (or every legacy source project). Choose `--source-kind current`, `legacy` or `preview` to match the source, not the desired output. **Every generated record starts with `reviewed: false` and `tagsAcknowledged: false`**, including direct mappings, already-canonical current records and records whose `required` list is empty. Suggestions are not approval; all records remain unresolved until both flags are explicitly approved. Edit only these per-record fields; retain record order, row hashes, source/context/tag evidence and top-level accounting unchanged:

- `projectType`: exactly one of 系统核心, 角色, 内容扩展, 玩法, 事件, 体验优化. Old 角色/系统/系统核心/事件 have prefilled suggestions (系统 becomes 系统核心), not automatic approval, and reviewed overrides are allowed. Old 扩展, unknown values, obsolete subtype values and old `project_types` require an explicit reviewed choice. Titles/descriptions are context, not a classification heuristic; previous trial labels are not authority.
- `includedTypes`: optional unique secondary categories from the same list, excluding 系统核心 and the chosen primary. Preserve intended secondary categories through reviewed mapping; do not infer personal facets/tags as categories.
- `reviewed` and `tagsAcknowledged`: explicitly set **both** to `true` for each record, only after resolving its required decisions and reviewing the source tag accounting. Leaving either flag false is rejected even when no classification or tag change is needed.
- `targetTags` and `tagChangeReason`: preserve valid source tags by default. If the target list changes, supply an explicit nonblank reason. Target tags must be unique, nonempty strings of **1–100 Unicode code points** each, with at most 20 values. API input uses JavaScript `trim()` normalization; persisted and reviewed tags must already be canonical, and the migration does not silently trim them. Boundary tabs or BOMs are noncanonical; U+0085 and U+0000 are retained and count toward the length limit. Acknowledgment alone cannot accept blank, duplicate, overlong or oversized tags. Original values remain in the private pinned review; the tool never silently truncates them. Invalid/unreadable tag data fails closed rather than becoming an empty list.

A duplicate within one original legacy array (`tags`, `custom_tags` or an individual facet-group array) requires an explicit valid `targetTags` replacement **and** a nonblank `tagChangeReason`, even when the replacement equals the merged unique list. The generated replacement is unresolved until supplied; acknowledgment alone is insufficient. The same tag appearing in separate source fields/groups is legitimate overlap and is merged in order without requiring a repair reason solely for that overlap.

Unresolved, missing, duplicated, reordered, stale or altered evidence is rejected. Keep the edited review with the candidate and original source; do not put private decision files or snapshots in Git. Only the agreed historical `author_note` field may be removed alongside obsolete taxonomy fields; descriptions and installation requirements are preserved. Exact removed values are accounted for privately in `removedFields`.

## Upgrade a current-stage snapshot locally

Use this path for an already-imported stage, including new projects, revisions, interactions and history. Set `SOURCE` to the fresh frozen local backup; `.sql` and standalone SQLite inputs are supported. Keep the reviewed candidate beside its source evidence under the original-root task directory. If the snapshot retains published imported revisions with independently accepted content omissions, use the [qualified legacy-provenance commands below](#preserve-verified-legacy-content-exceptions) instead of the plain build/verify commands:

```sh
umask 077
TASK="$ROOT/.local/tasks/taxonomy-migration"
SOURCE=/absolute/path/to/frozen-current.sqlite
mkdir -p "$TASK"
"$PYTHON" tools/migrate/offline.py taxonomy prepare-review \
  --source "$SOURCE" --source-kind current \
  --output "$TASK/review.json"
# Edit review.json using the decision rules above before continuing.
"$PYTHON" tools/migrate/offline.py taxonomy build \
  --source "$SOURCE" --review "$TASK/review.json" \
  --migrations apps/worker/migrations --output "$TASK/candidate"
"$PYTHON" tools/migrate/offline.py taxonomy verify \
  --source "$SOURCE" --review "$TASK/review.json" \
  --migrations apps/worker/migrations --candidate "$TASK/candidate" \
  --report "$TASK/verification.json"
```

Build creates `expected.sqlite`, a `candidate.json` seal with format `workshop-taxonomy-candidate-v2`, and an exact private `review.json` copy. It always reports `verified: false`; building is not acceptance. It writes only a new candidate, never the source. Every logical source business row/field is preserved except explicitly reviewed taxonomy/tags and accounted obsolete fields; unknown source tables or columns fail rather than disappearing. Version/publication/working pointers, descriptions, requirements, assets and object references, accounts/sessions, interactions, reviews, audit and recommendation history remain intact. Copying suspends application triggers to avoid fabricating counter/history changes, then restores the canonical schema and rebuilds only derived search/internal bookkeeping.

Run the independent `verify` command against the original source and edited review after building; acceptance requires its `ok: true` result. It compares non-taxonomy field values and row multiplicities, reviewed taxonomy/tags, canonical schema/search, foreign keys, application integrity and stored-row bounds, and verifies pinned source/review/migration/helper inputs. A changed username or history value is a failure even when counts still match. The report contains counts and hashes rather than private source values. Changes to sealed utilities or inputs require a fresh candidate-v2 build, not edited seals or reuse of an older-format candidate. Source and candidate SQLite files are read immutably; search checks use an in-memory copy.

These taxonomy commands are local only and produce no remotely executable import plan or binding cutover. Without legacy provenance they preserve object references without accessing object bytes; with provenance they additionally validate the supplied original local backup bytes as described below. Neither path proves remote R2 availability or byte completeness. Do not pass this candidate directory to `staging advance`. Object availability, actual application behavior and a separately authorized deployment/cutover procedure remain independent gates. Keep admission/writers and the final snapshot/cutover boundary under operator control so later stage additions cannot be overwritten.

`apps/worker/migrations/0001_initial.sql` is the current pre-launch **empty-database baseline**, not an in-place upgrade for an existing database. The tools replay it only into a new local candidate. Never apply it directly to an existing staging/production database; a verified candidate does not authorize deployment or bypass the [deployment safety gates](deployment-safety.md).

### Preserve verified legacy content exceptions

Some current snapshots retain an imported published revision whose content index was legitimately unavailable: original duplicate entry keys, or invalid content omitted from a private project. Such a revision is not automatically accepted because it has a legacy-looking ID or an omission in a JSON file. Supply independently verifiable provenance for each contributing original import with **`--legacy-provenance PREPARATION SOURCE_SQL MANIFEST`** on both `taxonomy build` and `taxonomy verify`. Each occurrence takes exactly three paths: its preparation file containing explicitly approved legacy decisions, its original legacy **SQL dump** (not the current SQLite snapshot), and its backup manifest. Keep the manifest's original local `r2/<bucket>/<key>` mirror available, including rejected/omitted content bytes.

Repeat the complete option for multiple imports; do not combine a preparation, SQL dump and manifest from different backups. For example, after preparing the current-source review above, the following uses two original imports. For a single import omit the second complete option from both commands:

```sh
PREPARATION_A=/absolute/path/to/first-import/preparation.json
BACKUP_A=/absolute/path/to/first-backup
PREPARATION_B=/absolute/path/to/second-import/preparation.json
BACKUP_B=/absolute/path/to/second-backup
"$PYTHON" tools/migrate/offline.py taxonomy build \
  --source "$SOURCE" --review "$TASK/review.json" \
  --migrations apps/worker/migrations --output "$TASK/candidate-with-provenance" \
  --legacy-provenance "$PREPARATION_A" "$BACKUP_A/d1/creative_workshop.sql" "$BACKUP_A/manifest.json" \
  --legacy-provenance "$PREPARATION_B" "$BACKUP_B/d1/creative_workshop.sql" "$BACKUP_B/manifest.json"
"$PYTHON" tools/migrate/offline.py taxonomy verify \
  --source "$SOURCE" --review "$TASK/review.json" \
  --migrations apps/worker/migrations --candidate "$TASK/candidate-with-provenance" \
  --legacy-provenance "$PREPARATION_A" "$BACKUP_A/d1/creative_workshop.sql" "$BACKUP_A/manifest.json" \
  --legacy-provenance "$PREPARATION_B" "$BACKUP_B/d1/creative_workshop.sql" "$BACKUP_B/manifest.json" \
  --report "$TASK/verification-with-provenance.json"
```

Build and separate verification each run the existing independent legacy source reconciliation and canonical application validation. They check the original SQL, approved source decisions, manifest and actual local content bytes; an asserted omission flag or mutually consistent preparation/current rows are not evidence of original metadata. Candidate-v2 pins these inputs, local backup files (including omitted objects), migrations and interpretation utilities. Pins bind bytes, not their source claims: a fresh preparation hash does not replace independent reconstruction from the original evidence. Pass the same complete set to verification; reordering complete triples is allowed, but duplicate original sources and conflicting provenance are rejected. Changed inputs or utilities require a fresh candidate, never an edited seal. Provenance inputs must be closed snapshots without WAL/SHM/journal sidecars; missing or corrupt local backup bytes fail closed.

Source reconciliation reconstructs **every canonical revision and asset column** independently of the preparation: deterministic IDs and associations, root-first numbering of the selected working/published revisions, original creators/timestamps and revision metadata, asset keys/hashes/sizes, content indexes/counts/manifest hashes, and the canonical null `schema_version`. Asset MIME comes from the original manifest's `http_metadata.contentType`, falling back to `application/json` for World Book/Regex or `application/octet-stream` for covers. Expected and prepared rows are materialized through the actual canonical schema and compared by stored values, SQLite types and multiplicities. This preserves real affinities, omitted defaults and nullable values; explicit NULL is not an omitted default and cannot bypass `NOT NULL`. A canonical revision or asset column without an independent source mapping fails closed **before** exception qualification.

An exception qualifies only for the exact original **currently published revision**: all canonical non-taxonomy revision values must match, as must the project identity, author, creation time, publication pointer/timestamps and the complete set of that revision's asset rows, including their types and metadata. Reviewed primary/included categories and tags may change; this is not permission to change revision prose or asset identity. Invalid-content omissions additionally require the original and current project both to remain private. Only the independently derived, qualified omission is supplied to application integrity. The inherited revision retains its null index/manifest and zero content counts; no index, content or readiness evidence is fabricated. An unrelated incomplete published revision still fails.

Provenance reconciliation can accept a storage-equivalent preparation only when the canonical schema produces the same values and types. This does not relax the legacy multiday planner's stricter reconciliation against the supplied raw preparation values. Keep the actual transformer-produced preparation unchanged for the original-backup `prepare`/planning workflow; do not substitute a normalized or storage-equivalent variant as planner input.

Provenance qualifies an inherited exception; it is **not** an old snapshot to restore over current data. Later working versions, current-only rows, counters, row versions, interactions and history remain copied from the current source and independently compared. Missing, wrong, stale, forged or conflicting evidence rejects the build before its output directory is created, or rejects verification of an existing candidate. Taxonomy input/integrity failures exit `1` with `{"ok":false,"error":"unresolved_stale_or_invalid_taxonomy_inputs"}`; an incomplete three-path CLI option is an argument-usage error (exit `2`). The verification report lists `acceptedImportedExceptions`, `legacySources` and `legacyProvenanceSha256`; those fields do not constitute remote R2 completeness or online-cutover evidence.

## Prepare an original legacy backup locally

Keep the backup manifest beside the original `r2/<bucket>/<key>` mirror. Set `BACKUP` to that backup's absolute directory and place generated artifacts under the original project's `.local/tasks/multiday-staging-migration/`. Select the actual SQL dump and manifest, not a sample export. First create and edit a `legacy` review; the existing `prepare` command requires `--review`. Neither the preparation file nor output plan directory may exist yet.

```sh
umask 077
BACKUP=/absolute/path/to/legacy-backup
LEGACY_TASK="$ROOT/.local/tasks/multiday-staging-migration"
mkdir -p "$LEGACY_TASK"
"$PYTHON" tools/migrate/offline.py taxonomy prepare-review \
  --source "$BACKUP/d1/creative_workshop.sql" --source-kind legacy \
  --output "$LEGACY_TASK/taxonomy-review.json"
# Edit taxonomy-review.json using the decision rules above before continuing.
"$PYTHON" tools/migrate/offline.py prepare \
  --source "$BACKUP/d1/creative_workshop.sql" --manifest "$BACKUP/manifest.json" \
  --review "$LEGACY_TASK/taxonomy-review.json" --migrations apps/worker/migrations \
  --preparation "$LEGACY_TASK/preparation.json" --output "$LEGACY_TASK/plan"
```

The command transforms available legacy records with the reviewed classifications/tags, verifies referenced source object bytes and hashes, independently reconciles raw source against candidate rows and exclusions, validates schema and application integrity, and creates sealed bounded SQL batches, an expected SQLite snapshot and source-check evidence. It embeds the pinned review in preparation and fails closed on unresolved/stale decisions, diagnostics, mismatches or changed inputs. Review `source-check.json`, preparation omissions, inventory and plan before any import. A published revision with invalid omitted content is accepted only for a private project under the narrowly verified incomplete-content exception; duplicate-key content has its own independently verified exception. Source site settings are imported, not silently replaced by staging settings. This legacy reconstruction retains its documented omissions; it must not be used to discard current-stage additions.

## Disposable local catalogue preview

[`tools/dev/load-legacy-fixture.mts`](../../tools/dev/load-legacy-fixture.mts) loads selected published catalogue fixtures, not a full migration candidate. Its source has `projects` and `project_revisions`, so create a separate `preview` review for the exact `legacyDbPath` SQLite file:

```sh
umask 077
PREVIEW_TASK="$ROOT/.local/legacy-preview"
LEGACY_DB=/absolute/path/to/legacy.sqlite
mkdir -p "$PREVIEW_TASK"
"$PYTHON" tools/migrate/offline.py taxonomy prepare-review \
  --source "$LEGACY_DB" --source-kind preview \
  --output "$PREVIEW_TASK/taxonomy-review.json"
# Edit the review; create the ignored local configuration using the example.
# Initialize the disposable preview first, then stop it before importing.
node --experimental-strip-types tools/dev/load-legacy-fixture.mts
```

Use [`load-legacy-fixture.config.example.json`](../../tools/dev/load-legacy-fixture.config.example.json) for `tools/dev/load-legacy-fixture.local.json` (or pass a private config path as the loader's argument). The loader resolves a relative config argument and **every configured path against the source checkout root containing the loader**, not the shell's working directory or the config file's directory. This includes `pythonPath`, `taxonomyReviewPath` and all source/preview D1/R2 paths. The example's `.local/` paths therefore refer to that checkout; when using a worktree, replace them with absolute original-root paths. Set `pythonPath` to the absolute value of `$PYTHON`, `taxonomyReviewPath` to `$PREVIEW_TASK/taxonomy-review.json`, and `legacyDbPath` to the exact `$LEGACY_DB` reviewed above, substituting the values in JSON (the loader does not expand shell variables). Keep the remaining paths and numeric limits explicit.

Initialize the disposable preview, then stop it before importing. The documented raw-Node invocation uses the Python resolver as its single taxonomy/tag validation authority and needs no contracts-package build or alternate TypeScript runtime. Every preview review record requires explicit `reviewed: true` and `tagsAcknowledged: true`; the loader resolves those decisions before opening its target. Unresolved or stale input fails without a taxonomy fallback, and unknown classes are not guessed as 事件. It replaces matching local projects and copies selected published content/covers directly into local preview storage. This is neither complete current-row/history preservation nor acceptance of a complete migration candidate or remote R2 object bytes.

## Offline verification scope

Complete current-snapshot verification accounts for **21 business tables + 3 derived search tables**. It independently compares typed row values and multiplicities, non-taxonomy fields, working/publication pointers, current-stage additions, accounts/history and object references, alongside canonical schema, foreign keys, integrity and search projections. SQLite and SQL-dump sources have the same explicit-both-flags review/build/separate-verify requirements. Unreviewed or stale decisions, unknown schema/fields and candidate corruption fail closed; invalid or duplicate legacy tags require the explicit repairs above. Imported content exceptions additionally require the qualified source-pinned provenance above; they do not waive general publication readiness.

Synthetic local verification establishes those offline behaviors, not correctness of an unexamined real snapshot. Keep private source/review/candidate evidence outside Git. Neither this verification nor a successful selected-fixture preview import proves remote R2 object availability/bytes, a live-stage migration, deployment or authorized cutover.

## Authorized staging candidate only

Separate explicit authorization is required before any remote operation. Supply a dedicated staging-scoped `STAGING_IMPORT_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for D1; object transfer requires separate bucket-scoped `STAGING_IMPORT_R2_ACCESS_KEY_ID` and `STAGING_IMPORT_R2_SECRET_ACCESS_KEY`. The tools do not read `.env` or use `CLOUDFLARE_API_TOKEN` automatically. Verify the account and `workshop-client-staging` bucket before invoking commands. Object upload uses conditional creation, verifies size and SHA-256 before and after transfer, and fails on conflicting existing objects; rerunning is safe for matching objects. `check` is local only.

```sh
"$PYTHON" tools/migrate/offline.py objects check --backup "$BACKUP" --preparation "$LEGACY_TASK/plan/preparation.json"
"$PYTHON" tools/migrate/offline.py objects upload --backup "$BACKUP" --preparation "$LEGACY_TASK/plan/preparation.json"
"$PYTHON" tools/migrate/offline.py objects verify --backup "$BACKUP" --preparation "$LEGACY_TASK/plan/preparation.json"
"$PYTHON" tools/migrate/offline.py staging advance --plan "$LEGACY_TASK/plan/plan.json" --state-dir "$LEGACY_TASK/state" --confirm-staging
"$PYTHON" tools/migrate/offline.py staging status --plan "$LEGACY_TASK/plan/plan.json" --state-dir "$LEGACY_TASK/state"
```

Advance operates on a new plan-named candidate database, never the active staging database. The private state directory stores account identity, candidate identity, budget reservations, import receipts and bookmarks. Preserve it and the sealed plan unchanged across restarts. Each invocation advances at most ten batches by default (`--max-batches` accepts 1–100). Exit 75 means more work or an account-budget wait; resume with the same command and state. `watch` waits and resumes automatically. An ambiguous ingestion is never blindly resubmitted: only a saved bookmark can be polled; preserve evidence and investigate unresolved or failed states rather than deleting receipts or restarting. Do not share account budget with uncontrolled writers during an import.

For a new plan on the same account, carry every known prior migration ledger before its first write, including abandoned candidates and unresolved reservations. Supply each independent prior state exactly once when creating the new state; omit `--prior-state` on all later invocations:

```sh
"$PYTHON" tools/migrate/offline.py staging advance --plan "$LEGACY_TASK/plan/plan.json" --state-dir "$LEGACY_TASK/state" --prior-state /absolute/path/to/prior/staging-state --confirm-staging
```

Repeat `--prior-state` for independent histories. If a prior state already carries another, supply only the descendant; overlapping provenance is rejected. The initialized receipt records source paths, plan identities and receipt hashes; the source account and ledger must be verifiable. Do not run prior and new candidates concurrently or modify prior journals after carrying them: this is a snapshot, not an account-wide lock. Missing, unknown or external writers cannot be inferred from delayed analytics. Unknown reservations remain charged. If an actual import receipt exceeds its reservation, the full actual charge is recorded and execution fails before further writes; investigate rather than replaying.

### Actual-use daily budget

The admission target is the account's D1 Free allowance: 100,000 written rows and 5,000,000 read rows per UTC day, not an additional 50,000-row migration allowance or 70,000-row account cap. These are the [published D1 pricing limits](https://developers.cloudflare.com/d1/platform/pricing/); they do not prove this account's subscription tier. No paid overage is authorized. Complete atomic batches may leave unused capacity; do not manufacture writes to consume it.

For ordinary inserts, estimate the row plus affected indexes rather than multiplying by a speculative B-tree factor. Successful authoritative import receipts calibrate reservations by phase and data-row count, with 25% headroom and a minimum reservation. Unobserved FTS, schema and chunk operations retain a conservative fallback until suitable observations exist. Estimates are admission forecasts, not guaranteed billing bounds. Keep the actual write count and reservation in the durable journal; missing accounting or an overrun stops further writes.

Account accounting combines a persisted day's observed baseline with the larger of subsequent observed account growth and locally charged migration writes, avoiding wholesale double-counting of receipts already visible in analytics. Legacy ledgers without a baseline are adopted conservatively. Delayed analytics cannot reveal concurrent external writes immediately: stop uncontrolled writers and preserve unknown reservations. Refresh account analytics before each admission. A reset does not refund an operation whose execution day is uncertain.

### Continuing a sealed plan after a policy correction

Do not regenerate SQL, recreate the candidate or replay completed batches to change admission algorithms. With no pending operation or failed state, explicitly adopt the corrected executor:

```sh
"$PYTHON" tools/migrate/offline.py staging adopt --plan "$LEGACY_TASK/plan/plan.json" --state-dir "$LEGACY_TASK/state" --confirm-staging
```

Adoption preserves the original plan bytes and candidate. It verifies the original utility files still match their seals, allows changes only to the planner/executor/budget policy utilities, and pins the replacement utilities, immutable SQL/data inputs, checkpoint receipt and completed receipt hashes. Resume from the corrected checkout with the same plan and state; retain the original checkout needed to validate the old seals. Changed SQL, missing completion evidence, a changed authorized utility or an unresolved operation fails closed. Receipt-derived phase costs are persisted and checked again on each continuation. Adoption is a local authorization record, not a database mutation or an assertion that partially imported data has passed final reconciliation.

After all batches, the executor snapshots the actual candidate, independently reconciles source and target rows, compares schema and search indexes and writes verification evidence. Repeat explicitly if necessary:

```sh
"$PYTHON" tools/migrate/offline.py staging verify --plan "$LEGACY_TASK/plan/plan.json" --state-dir "$LEGACY_TASK/state" --confirm-staging
```

A verified candidate is not automatically activated. Independently verify R2, application behavior, access controls and the operational cutover and rollback plan before any separately authorized binding change. The old public-sample importer is not an acceptance path. Backup export utility `from_d1_sql.py` remains available for its independent verification format.

## Production preparation and acceptance gates

The current remote CLI is staging-only. Do not rename a staging token, bypass target checks or substitute a production database ID to reuse it. Production execution requires a separately authorized, explicitly production-targeted entry point with equivalent identity, journal, quota and no-replay protections. Reuse the offline transformation, sealed-plan construction, receipt accounting and independent reconciliation rather than copying task-local recovery scripts into production.

Prepare real authenticated acceptance access before the cutover window. A configured `SESSION_HASH_SECRET` HMAC-signs session verifiers: a plain-SHA fixture that works locally will not authenticate remotely. Cloudflare management credentials and the maintenance password are not application sessions, and the secret-list API does not return secret values. Use an authorized real login/session; never rotate, remove or weaken the signing secret just to make smoke checks pass. If authenticated acceptance cannot proceed, close and drain admission and keep cron disabled rather than treating anonymous smoke as full acceptance.

When explicitly authorized, isolated synthetic identities can exercise application authorization without reading the signing secret or deploying an authentication bypass. Create fresh device-mode flows through the normal endpoint, retain their browser-binding cookies and device codes only in memory, and record exact fixture user/flow IDs privately before mutations. Authorize only those pending device flows for the allowlisted fixture identities through scoped management writes; redeem through the unchanged application endpoint so its existing secret signs normal sessions. Verify missing-binding and incorrect-device-code rejection, role boundaries, persisted writes and authenticated download bytes. Revoke sessions, remove only fixture-owned rows, verify database cleanup and confirm the old tokens return 401. Never rely on session expiry or change existing users' roles. Report this as synthetic authenticated workflow acceptance: it does not verify Discord OAuth, guild membership or Discord role checks, and it is not automatically authorized for production.

Before authorizing production writes:

1. Inventory every Worker binding, scheduled writer and other account writer. Close admission and stop scheduled work before draining. A closed status alone is insufficient: exercise the actual admission path and confirm it rejects new tickets. Reconcile abandoned tickets only through a separately reviewed recovery procedure; an empty ticket set is not proof that uncertain historical operations never wrote.
2. Capture and verify a fresh production source backup and object manifest. Review exclusions and source-to-target reconciliation. Do not reuse a staging checkpoint, candidate, maintenance password or stale snapshot for production. Freeze the authorized utility checkout and retain the original sealed utilities across any explicit policy adoption.
3. Confirm the account's actual plan and current UTC-day usage. Ordinary index billing and FTS internal writes differ; use receipt-backed phase calibration, not a global bytes-to-writes multiplier. Account analytics lag, and the migration journal is not a lock on unrelated account writers. Preserve their usage in the budget and preserve unresolved charges.
4. Use a new, positively identified candidate and a private durable journal. Retrying transport must never mean replaying an unknown D1 ingest. Exit 75 alone does not identify quota exhaustion: inspect the phase, checkpoint and budget reason; a command batch bound can be continued immediately when admission still permits it.
5. Transfer objects with conditional creation and byte/SHA-256 verification. On interruption, resume matching objects instead of clearing the bucket again. Verify the entire final key set for both missing and unexpected objects; per-object success alone cannot detect extra objects. Bound transfer concurrency and diagnose direct versus proxy transport separately from application failures.
6. Require full remote/source/schema/search reconciliation, not just counts, foreign-key checks or `quick_check`. Validate actual application permissions, private/public reads, downloads and controlled writes against the candidate before final acceptance. The application barrier guards all application requests except maintenance, including reads: while closed, document navigations return a standalone Chinese HTML 503 with `no-store` and `Retry-After`, while API and client requests retain the JSON 503. Only compiled `/assets/*` GET/HEAD requests bypass admission, and they are served exclusively from the static asset binding, not D1 or R2; `/api/v1/assets/*` and client distribution remain guarded. Verify maintenance state and rejected admission; application journeys require a controlled admission window with cron still disabled. Close and drain again if a journey fails. Retain exact verification evidence and any historical uncertainty.
7. Check every target binding against the verified candidate immediately before deployment. Deploy the real application with admission still closed and cron disabled; verify maintenance authentication and rejected admission, then validate client/checker artifacts during the controlled acceptance window. Only leave admission open and restore cron after acceptance. Keep the old target and a documented binding rollback until rollback retirement is separately approved; do not use staging's authorized destructive reset as a production procedure.

Keep raw migration receipts, private snapshots, transport evidence and recovery records in the task's private runtime directory. Record portable invariants in tools and regression tests; never put credentials, private source data or machine-specific recovery state in this runbook.
