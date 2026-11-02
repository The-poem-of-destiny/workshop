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
- `full-d1-import.py` owns target validation, durable import receipts and bookmark-only polling.
- `full-r2.mjs` verifies and conditionally creates staging objects.
- `full-staging-rehearse.py`, `full-staging-load.py` and `full-staging-control.py` orchestrate isolated rehearsal, gated replacement, maintenance and anonymous read-only smoke.

`test-full-import.py`, `test-full-source.py` and `test-full-index.py` cover import ambiguity, public/working snapshot separation and independently derived content indexes. They run through the root `pnpm check` gate.
