# Repository Agent Bootstrap

This repository is the standalone Creative Workshop: the SillyTavern client bundle and the Cloudflare Worker backend. Card content, worldbooks, artwork and the dialogue beautifier live in the card repository.

## Remotes and identity

- `origin` → `git@github.com:The-poem-of-destiny/workshop.git`
- Local Git identity for every checkout: `aoo` / `lxxxaoo@users.noreply.github.com`. Never change the global identity.

Verify the actual remote URL before the first remote operation in a session. Do not infer ownership from the remote name.

## Canonical refs

- `origin/main` is the only long-lived branch and the base for all new work.
- `archive/release-*` branches are frozen historical refs. Do not build, merge, or deploy from them.
- Task branches are short-lived: `fix/*`, `feature/*`, `chore/*`. Integrate into `main`, then delete.
- Tags are immutable release markers. Never move or re-push an existing tag.

Work starts from refreshed `origin/main`, never from the local worktree HEAD alone.

## Build and verification

Root (pnpm):

- `pnpm build` — Tavern client bundles and the legacy-path shim
- `pnpm check` — workspace, contracts/domain/worker types, tests, schema, migration tests and Wrangler dry-run
- `pnpm check:workshop-bundles` — built client artifact verification

Worker (`apps/worker`, pnpm workspace):

- `pnpm --filter @workshop/worker dev` — local Worker
- `pnpm --filter @workshop/worker web:build` — build Static Assets
- `pnpm --filter @workshop/worker test` — Worker tests

Run `pnpm check` and the bundle verification after any build-pipeline change. Built bundles are generated artifacts; never hand-edit them.

## Agent skills

Read the relevant skill before starting work; do not rely on memory of it.

- Project engineering basics (format, lint, typecheck, tests, CI, hooks, and what a reasonable test is): `.agents/skills/project-basics/SKILL.md`.
- Autonomous large refactor (spec freeze, slice loop, parallel delegation, verification, handoff): `.agents/skills/autonomous-refactor/SKILL.md`. Read it before starting or resuming the rewrite under `docs/plans/refactor-2026-10/`.
- Keep reusable skills one level under `.agents/skills/<name>/SKILL.md`; omp discovers that root by default.

## Single sources of truth

- Client version, distribution paths and companion-script dependencies: `config/workshop.json`. Never repeat live values in code, docs, tests or deployment scripts; import the manifest.
- Worker endpoints and bindings: `apps/worker/wrangler.jsonc`.
- New-database structure: `apps/worker/migrations/0001_initial.sql`. Existing databases evolve only through `apps/worker/migrations/`.
- Project taxonomy, content policy and runtime limits: `packages/domain/src/`; ranking parameters: `apps/worker/src/storage/home.ts`.
- Product and creator-facing wording: plain everyday Chinese, no internal field or implementation names in the UI.

## Deployment

Git history and Cloudflare runtime are separate states.

- Record the exact commit SHA before deploying and verify the resulting Worker version afterwards.
- Never treat a push as a deployment, and never treat the newest local deploy log as proof of the live version.
- Secrets go through `wrangler secret put`. Never commit credentials, tokens or D1/R2 dumps.
- Do not hand-edit production D1. Schema changes need a migration, verified locally first.
- Deployment workflows live in `.github/workflows/`; environment configs live in `apps/worker/wrangler.jsonc`.

## Session closeout

Report the branch, created commit SHAs, what was pushed where, whether `origin/main` contains the change, and any intentional leftovers.
