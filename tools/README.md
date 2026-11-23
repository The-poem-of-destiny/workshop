# Repository tools

Development harnesses, repository checks, and data-operation utilities. Command wiring lives in the [root package scripts](../package.json); setup is in the [root README](../README.md).

## Checks and local harnesses

- [Workspace check](check-workspace.mjs) checks repository structure, workspace script policy, tool test wiring, and relative Markdown links. [Schema check](check-schema.mjs) replays the [Worker migration chain](../apps/worker/migrations/) into in-memory SQLite and exercises schema invariants; it does not apply remote migrations.
- [Architecture check](../apps/worker/tools/check-architecture.mjs) enforces workspace dependency direction, Web isolation from Worker implementation and storage's type-only data contracts. [Bundle size check](check-bundle-size.mjs) enforces emitted frontend gzip ceilings.
- [Dependency security policy](dependency-update-policy.mjs) and [runner](dependency-update-policy-run.mjs) evaluate Dependabot security PR qualification, viewer-enforced branch protection, and cleanup/recovery gates; see [dependency security updates](../docs/operations/deployment-safety.md#dependency-security-updates).
- [Local E2E](e2e-local.mjs) starts a real local Worker with D1/R2 and drives API/browser flows against isolated temporary state.
- [Preview debug harness](preview-debug.mjs) starts the local Worker, debug frontend, and seeded role-preview state (`pnpm preview:debug`); environment variables and usage are in the [root README](../README.md#本地开发).

## Data operations

- [Migration tools](migrate/README.md) route offline taxonomy/legacy preparation, public-image replication, bound D1 preload, SQLite delta generation, and staging control; procedures and safety boundaries live in the [legacy data migration runbook](../docs/operations/legacy-data-migration.md).
- [Legacy preview fixture](dev/load-legacy-fixture.mts) (configured from [`load-legacy-fixture.config.example.json`](dev/load-legacy-fixture.config.example.json)) loads reviewed published projects into disposable local preview storage; path resolution and review requirements live in [disposable local catalogue preview](../docs/operations/legacy-data-migration.md#disposable-local-catalogue-preview).
- [Backup verifier](backup/verify.mjs) checks local exported project/revision pointers and mirrored asset hashes/sizes without mutating live state; see the [deployment safety runbook](../docs/operations/deployment-safety.md).
- [Companion version push](push-companion-version.mjs) registers an immutable companion script version via the owner HTTP API (`WORKSHOP_SESSION_TOKEN`) and verifies its anonymous read; endpoint contract lives in the [Worker API reference](../docs/reference/worker-api.md#审核和管理).

Application behavior remains in [apps](../apps/README.md); shared schemas, domain rules, and checker implementation live in [packages](../packages/README.md).
