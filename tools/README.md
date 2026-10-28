# Repository tools

Development harnesses, repository checks, and data-operation utilities. Command wiring lives in the [root package scripts](../package.json); setup is in the [root README](../README.md).

## Checks and local harnesses

- [Workspace check](check-workspace.mjs) checks repository structure and configuration. [Schema check](check-schema.mjs) replays the [Worker migration chain](../apps/worker/migrations/) into in-memory SQLite and exercises schema invariants; it does not apply remote migrations.
- [Local E2E](e2e-local.mjs) starts a real local Worker with D1/R2 and drives API/browser flows. It seeds and mutates local state, using isolated temporary state by default.
- [Preview debug harness](preview-debug.mjs) seeds accounts and sample author/review data into local preview state and serves the debug frontend. It is not a read-only viewer; its backend endpoint and state selection are defined in the script.

## Data operations

- [Migration guide](migrate/README.md) covers the local legacy-export converter, verification, local D1 loading, and local asset copying.
- [Backup verifier](backup/verify.mjs) checks local exported project/revision pointers and mirrored asset hashes/sizes. It neither creates a backup nor restores or modifies the live database. Backup and recovery procedures live in the [deployment safety runbook](../docs/operations/deployment-safety.md).
- [Companion version push](push-companion-version.mjs) registers one exact script version through the owner-only HTTP API, then verifies its anonymous exact-version read. Pass `--script`, `--version`, `--name`, `--url` and optionally `--origin`; credentials come only from `WORKSHOP_SESSION_TOKEN`, never `.env`. Defaults to local HTTP; remote registration requires explicit authorization. It records metadata, not script storage or business data.

Application behavior remains in [apps](../apps/README.md); shared schemas, domain rules, and checker implementation live in [packages](../packages/README.md).
