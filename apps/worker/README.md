# Worker and Web

This application contains the backend and its React site. The Web build is served by the Worker's Static Assets configuration, not deployed as a separate application. The SillyTavern host runtime lives in [`../tavern-client/`](../tavern-client/README.md).

## Backend navigation

| Task | Entry points |
| --- | --- |
| Request dispatch, public-cache routing, scheduled work | [`src/index.ts`](src/index.ts), [`src/http/public-cache.ts`](src/http/public-cache.ts), [`src/scheduler.ts`](src/scheduler.ts) |
| API composition and HTTP handlers | [`src/app.ts`](src/app.ts) mounts [`src/http/routes/`](src/http/routes/); handlers delegate persistence to [`src/storage/`](src/storage/) |
| Content validation and submission processing | [`src/content-service.ts`](src/content-service.ts), [`src/content-checker.ts`](src/content-checker.ts); checker implementation belongs to [`packages/content`](../../packages/content/) |
| Database structure and runtime bindings | Numbered SQL in [`migrations/`](migrations/); bindings and asset routing in [`wrangler.jsonc`](wrangler.jsonc), binding types in [`src/env.ts`](src/env.ts) |
| Client bundle distribution rather than host installation logic | [`src/http/routes/client.ts`](src/http/routes/client.ts), [`src/http/routes/client-api.ts`](src/http/routes/client-api.ts) |

Shared request/response schemas belong to [`packages/contracts`](../../packages/contracts/), and reusable domain rules to [`packages/domain`](../../packages/domain/). The [API design document](../../docs/plans/refactor-2026-10/api-design.md) provides design context rather than a second route inventory.

## Web navigation

- Bootstrap and application composition: [`web/src/main.tsx`](web/src/main.tsx), [`web/src/App.tsx`](web/src/App.tsx).
- Requests to the backend: [`web/src/api.ts`](web/src/api.ts).
- Browsing and authoring: [`web/src/features/projects/`](web/src/features/projects/). Review UI: [`web/src/features/review/`](web/src/features/review/); site/member administration: [`web/src/AdminTools.tsx`](web/src/AdminTools.tsx).
- Installation UI: [`web/src/features/installed/`](web/src/features/installed/). The [Web application](web/src/App.tsx) requests operations from the [Tavern host runtime](../tavern-client/src/index.ts); host mutations do not run in the site itself.
- Shared widgets and styling: [`web/src/components/`](web/src/components/), [`web/src/styles.css`](web/src/styles.css), [`web/src/styles/`](web/src/styles/).

## Source and output

[`web/vite.config.ts`](web/vite.config.ts) builds `web/src/` and [`web/public/`](web/public/) into generated `web/dist/`, which [`wrangler.jsonc`](wrangler.jsonc) binds as Static Assets. `.wrangler/` is local tooling state, not application source.

Application scripts are in [`package.json`](package.json). Existing tests are under [`test/`](test/), with runtime setup in [`vitest.config.ts`](vitest.config.ts). Deployment and backup procedures live in the [root overview](../../README.md#部署) and [deployment safety document](../../docs/operations/deployment-safety.md).
