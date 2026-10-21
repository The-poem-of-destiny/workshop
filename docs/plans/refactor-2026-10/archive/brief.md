# Independent refactor plan — Creative Workshop

You are an external software architect. Produce an independent refactor plan from the repository and the facts below. Do not read any other plan under `projects/命定之诗/_plans/`; another model is working separately.

## Repository

`/home/zz/world-builder/projects/命定之诗/workshop` — a standalone Git repo (branch `main`), recently split from a character-card repo. It is the "Creative Workshop" for a SillyTavern card: a Tavern Helper client script plus a Cloudflare Worker backend serving a web UI, an API, and file distribution.

Read `AGENTS.md`, `README.md`, `config/workshop.json`, `package.json`, `cloudflare/package.json`, `cloudflare/wrangler.jsonc`, `cloudflare/schema.sql`, and the source before writing. Verify every number below.

Known scale:
- Worker TypeScript ~29k LOC: `cloudflare/src/index.ts` (routes, middleware, DO export, cron), `endpoints/` ~4.5k, `utils/` ~8.4k (`utils/db.ts` 1,916), `pages/home/` ~15k.
- 50 OpenAPI routes (Hono + chanfana + zod), 3 manual GET routes (`/`, `/assets/*`, `/api/files/*`), and a Durable Object `CodeCheckService` that receives project detail/upload/review requests via a regex dispatcher (`contentServiceKey`) duplicating the Hono route table.
- The browser UI is not a real frontend: ~15k LOC of browser JS lives inside TS files as `String.raw` template literals, concatenated in `pages/home/app.ts`, served as `/assets/home.js` (~277KB), validated only by `new Function()` in `cloudflare/scripts/check-home-js.mjs`.
- 74 node test scripts under `cloudflare/tests` (most assert source text with regex; a few transpile and execute handlers with mocks) + 10 Playwright specs under `tests/e2e`.
- Two package managers: root pnpm (webpack, client bundle) and `cloudflare/` npm. Committed build artifacts: `dist/`, `test-dist/`, `test-bundles/`, `cloudflare/src/generated/*.txt` (~932KB).
- Data: D1 (`schema.sql` + 36 migrations), R2 for project files/covers, KV for OAuth state, one Durable Object, cron for rankings.
- Hosting: one Worker (`wrangler.jsonc`), separate staging configs. Deployment uses a PowerShell helper hardcoded to `upstream/main`, with machine-local profiles not in the repo.
- Caching today: `caches.default` in 3 places (project list keyed by a revision counter, editor picks, banner), `Cache-Control` middleware for 5 paths, a client in-memory list cache (15s fresh / 60s stale), Tavern Helper variable caches (5 min).

## History and suspicion

This codebase was heavily modified by non-programmers working with AI assistants. Assume over-engineering, detours, patch-on-patch workarounds, dead parameters, redundant caches, tests that assert implementation strings instead of behavior, and features that exist only because someone asked an AI for them. Do not trust prior architectural decisions. The 50-route design is not sacred. Verify claims by reading code and cite `path:line`.

## Target

- End state: clear, reliable, modern.
- Thorough restructuring or partial rewrite is allowed; moving files is not enough.
- Product features stay broadly the same.
- The web UI will later be rebuilt with React + Tailwind + shadcn/ui + Vite. Design the repo/backend boundary for that; do not design UI.
- Cutover is one-shot after the new system is tested; the old system stays online until then. No backward compatibility with the current client is required — define the final contract.
- A new database will be created and data migrated; the old D1/R2 stay untouched until cutover. The schema may be redesigned.
- Stay on Cloudflare (Workers, D1, R2, KV, Durable Objects, Static Assets). No new vendors.

## Deliverable

Write `PLAN.md` (Chinese) in the current working directory, covering:

1. Diagnosis with evidence and severity ranking; an explicit delete list.
2. Target architecture: repo tree, package boundaries and dependency rules, runtime topology, data access, config, auth/error model, API contract (challenge the current route design), caching.
3. Migration plan: phases with acceptance criteria and rollback; include the one-shot cutover and data migration.
4. Testing strategy: what to keep, delete, add.
5. Build/release/deployment strategy: artifacts, CI, environments.
6. Risks and open questions.
7. A short "what I would not change" section.

Rules: do not modify any file except `PLAN.md` in the current directory; do not run builds that write into the repository; be opinionated; prefer boring maintainable designs; the plan must be actionable, not aspirational.
