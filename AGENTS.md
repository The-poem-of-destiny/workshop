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

- `pnpm build` — stable and staging client bundles plus the legacy-path shim
- `pnpm check:workshop-config` — manifest, build wiring and documentation consistency
- `pnpm check:workshop-bundles` — built artifact verification

Worker (npm, inside `cloudflare/`):

- `npm run cf-typegen` before `npm run check:types`; the generated types file is not committed
- `npm run check:home-js-smoke` and the other `check:*` scripts cover page and API contracts

Run the config check and the bundle verification after any build-pipeline change. A rebuilt bundle legitimately differs from the committed one in source-map bytes; regenerate rather than hand-edit.

## Single sources of truth

- Client version, distribution paths, service endpoints and companion-script dependencies: `config/workshop.json`. Never repeat live values in code, docs, tests or deployment scripts; import the manifest.
- New-database structure: `cloudflare/schema.sql`. Existing databases evolve only through `cloudflare/migrations/`.
- Project taxonomy, content policy, ranking parameters and runtime limits: `cloudflare/src/config/` and `cloudflare/src/utils/`.
- Product and creator-facing wording: plain everyday Chinese, no internal field or implementation names in the UI.

## Deployment

Git history and Cloudflare runtime are separate states.

- Record the exact commit SHA before deploying and verify the resulting Worker version afterwards.
- Never treat a push as a deployment, and never treat the newest local deploy log as proof of the live version.
- Secrets go through `wrangler secret put`. Never commit credentials, tokens or D1/R2 dumps.
- Do not hand-edit production D1. Schema changes need a migration, verified locally first.
- Deployment helpers and environment configs live in `scripts/deployment/` and `cloudflare/wrangler*.jsonc`.

## Session closeout

Report the branch, created commit SHAs, what was pushed where, whether `origin/main` contains the change, and any intentional leftovers.
