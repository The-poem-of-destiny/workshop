# Tavern client

A browser script running inside SillyTavern. It opens the Workshop site in an iframe and connects installation operations to Tavern host APIs. The React site and backend remain in [`../worker/`](../worker/README.md); this is not a second Web application.

## Find the implementation

| Task | Entry points |
| --- | --- |
| Host integration, Workshop iframe and message handling | [`src/index.ts`](src/index.ts); counterpart in the site: [`App.tsx`](../worker/web/src/App.tsx) |
| Installation/update/removal and host worldbook/regex operations | [`src/index.ts`](src/index.ts); shared content helpers in [`src/lib.ts`](src/lib.ts) |
| Official-card baseline data and fingerprint generation | [`data/official-card-baselines/README.md`](data/official-card-baselines/README.md) |
| Bundle generation and channel publication | [`scripts/build.mjs`](scripts/build.mjs), [`scripts/publish.mjs`](scripts/publish.mjs) |

Client artifact serving and backend client endpoints are in the Worker's [`client.ts`](../worker/src/http/routes/client.ts) and [`client-api.ts`](../worker/src/http/routes/client-api.ts), separate from host-side mutations here.

## Source and output

[`scripts/build.mjs`](scripts/build.mjs) bundles `src/index.ts` into generated `dist/index.js` and writes `dist/manifest.json`. The package version and build-time origin are inputs to that script, not values maintained in this README. Tracked compact baseline data and ignored full extraction output are distinguished in the [baseline README](data/official-card-baselines/README.md).

Scripts are listed in [`package.json`](package.json); existing tests live in [`test/`](test/). Release workflow context remains in the [root deployment overview](../../README.md#部署).
