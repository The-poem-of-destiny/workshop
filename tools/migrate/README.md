# Migration tools

Scope, commands, authorization, maintenance, import recovery and verification belong in the [migration runbook](../../docs/operations/legacy-data-migration.md). Neither tool family is a production-cutover authorization or a lossless historical migration.

## Public samples

- `from_d1_sql.py` exports an explicitly selected public subset.
- `cli.mjs` / `lib.mjs` orchestrate local transformation, reconciliation and additive SQL; `entities.mjs`, `assets.mjs`, `validation.mjs` and `values.mjs` own their respective data contracts.
- `load-local.mjs` and `r2-copy.mjs` operate on isolated local state.
- `import-staging.mjs` / `import-r2.mjs` implement the separately authorized staging sample import.

## Current Published/Working Snapshots

- `full-transform.py`, `full_transform_history.py` and `full-transform-content.mjs` prepare current snapshots and explicit omissions.
- `full-load.py` independently reconciles source data and original asset bytes, generates SQL and checks target rows; `full-validate.py` exercises the current schema locally.
- `multiday-plan.py` seals schema, source, utilities and bounded final-state SQL; `multiday-budget.py` reserves daily account capacity; `multiday-staging.py` resumes and verifies owned unbound candidates.
- `full-d1-import.py` owns target validation, durable import receipts and bookmark-only polling; `d1-data.py` owns bounded typed snapshots.
- `full-r2.mjs` verifies and conditionally creates staging objects.
- `full-staging-control.py` owns separately authorized maintenance and anonymous read-only smoke. Obsolete in-place replacement and rehearsal entrypoints have been removed; candidate verification does not authorize binding changes.

`test-full-import.py`, `test-full-source.py` and `test-full-index.py` cover import ambiguity, public/working snapshot separation and independently derived content indexes. They run through the root `pnpm check` gate.

Public-sample imports preserve the last approval time in both publication timestamps; later draft edits do not move the public update time.
Public-sample selection filters and deduplicates before limiting. The default order is project ID ascending; `--order updated-desc` selects update time descending instead. Narrowing the sample is not full-migration acceptance.
