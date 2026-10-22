# AGENTS.md — Creative Workshop

This repository is the standalone Creative Workshop for the card project: the SillyTavern client bundle and the Cloudflare Worker backend. Card content, worldbooks, artwork and the dialogue beautifier live in the card repository.

## Read first

- `docs/AGENTS.md` — document homes, authority and writing rules.
- `.agents/AGENTS.md` — project-local notes, skills and shared resources.

Read the relevant skill before starting work; do not rely on memory of it.

## Canonical refs

- `origin/main` is the integration branch and the base for all work.
- `work` is the daily working branch. Start or rebase it from refreshed `origin/main`.
- `archive/release-*` branches are frozen historical refs. Do not build, merge or deploy from them.
- Task branches are optional and short-lived: `fix/*`, `feature/*`, `chore/*`. Integrate into `main`, then delete.
- Tags are immutable release markers. Never move or re-push an existing tag.

Work starts from refreshed `origin/main`, never from the local worktree HEAD alone.

## PR rules

- Do not commit directly to `main`; integrate through a PR from `work`.
- Batch related code, tests, config and docs into one PR.
- Do not open a PR for docs, comments or small config alone; fold them into the next change.
- Run `pnpm check` and the relevant E2E tests before opening; report what actually ran.
- Merge only when `check` and `e2e` pass; delete task branches afterwards.

## Repository boundaries

- `apps/worker/` is the only backend; `apps/tavern-client/` is the client bundle.
- `packages/contracts/` owns shared contracts, `packages/domain/` owns pure rules, and `packages/content/` owns checker and content auditing.
- `docs/` owns current knowledge and refactor records; `.agents/` owns notes and reusable agent procedures. Follow `docs/AGENTS.md` for document placement.
- `tools/` owns checks, migrations, local E2E and backup verification. Do not duplicate tool logic in ad-hoc scripts.
- `../workshop-legacy` is read-only reference. Never edit or build it from this repository.
- Generated output (`.wrangler/`, `web/dist/`, `tavern-client/dist/`, `data_backup/`) is excluded from Git and never maintained by hand.
- Do not reintroduce the deleted legacy entry points (`cloudflare/`, old `src/`, `util/`, old `config/`, `test-dist/` or the old webpack chain).

## Build and verification

Root (pnpm):

- `pnpm build` — build the Worker Static Assets.
- `pnpm check` — workspace, contracts/domain/worker types, tests, schema, migration and backup tests, and Wrangler dry-run.
- `pnpm e2e:local` — real workerd with local D1/R2 HTTP E2E.

Worker (`apps/worker`, pnpm workspace):

- `pnpm --filter @workshop/worker dev` — local Worker.
- `pnpm --filter @workshop/worker web:build` — build Static Assets.
- `pnpm --filter @workshop/worker test` — Worker tests.

Report the commands actually run, their result, and the acceptance item they cover. A passing typecheck is not a runtime test; a passing build is not a deployment; a local test is not proof of the live Cloudflare environment.

## Documentation and decisions

- `docs/` describes current behavior, contracts, architecture, tutorials and lookup information.
- `.agents/notes/` holds durable proposals, decisions, rationale, alternatives, consequences and verification requirements.
- `.agents/skills/` holds reusable agent procedures. Keep each skill in its own directory with a `SKILL.md`.
- Current progress, task status, sessions, logs, caches and generated output belong to runtime storage or the relevant task record, not to `docs/`.

Give every durable fact one authoritative home and link to it elsewhere. Do not copy the same rule, schema or contract into multiple layers.

When a process or organization rule changes, update the owning artifact (`AGENTS.md`, `docs/AGENTS.md`, a skill, or an Agent Note) in the same change. If a discussion establishes a reusable process change, name the affected skill or document explicitly instead of leaving it only in conversation.

## Single sources of truth

- Worker endpoints and bindings: `apps/worker/wrangler.jsonc`.
- Client version and distribution paths: `apps/tavern-client/`.
- New-database structure: `apps/worker/migrations/0001_initial.sql`. Existing databases evolve only through `apps/worker/migrations/`.
- Project taxonomy, content policy and runtime limits: `packages/domain/src/`; ranking parameters: `apps/worker/src/storage/home.ts`.
- Product and creator-facing wording: plain everyday Chinese, with no internal field or implementation names in the UI.

## Deployment

Git history and Cloudflare runtime are separate states.

- Record the exact commit SHA before deploying and verify the resulting Worker version afterwards.
- Never treat a push as a deployment, and never treat the newest local deploy log as proof of the live version.
- Secrets go through `wrangler secret put`. Never commit credentials, tokens or D1/R2 dumps.
- Do not hand-edit production D1. Schema changes need a migration, verified locally first.
- Deployment workflows live in `.github/workflows/`; environment configs live in `apps/worker/wrangler.jsonc`.
- Staging deploys only from `main`; the staging environment rejects other branches.
- Production deploys only from a `v*` tag, with one required reviewer. Production cutover requires explicit authorization and a verified rollback target.

## Session closeout

Report the branch, created commit SHAs, what was pushed where, whether `origin/main` contains the change, and any intentional leftovers.
