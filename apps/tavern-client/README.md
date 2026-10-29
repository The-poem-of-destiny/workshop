# Tavern client

A browser script running inside SillyTavern. It opens the Workshop site in an iframe and connects installation operations to Tavern host APIs. The React site and backend remain in [`../worker/`](../worker/README.md); this is not a second Web application.

## Find the implementation

| Task | Entry points |
| --- | --- |
| Host integration, Workshop iframe and message handling | [`src/index.ts`](src/index.ts); counterpart in the site: [`install-bridge.ts`](../worker/web/src/lib/install-bridge.ts) |
| Scan installed content, preview changes, confirm installation/update/removal | [`src/install.ts`](src/install.ts) |
| Host scanning and legacy normalization | [`src/install-discovery.ts`](src/install-discovery.ts) |
| Permission/location checks and preview diff | [`src/install-preview.ts`](src/install-preview.ts); shared identities and diff types in [`src/install-model.ts`](src/install-model.ts) |
| Confirmed host writes and read-back verification | [`src/installation.ts`](src/installation.ts); script variables and trusted origins in [`src/install-registry.ts`](src/install-registry.ts) |
| Translate content into host worldbook/regex representations | [`src/host-projection.ts`](src/host-projection.ts), [`src/regex-host.ts`](src/regex-host.ts) |
| Official-card baseline data and fingerprint generation | [`data/official-card-baselines/README.md`](data/official-card-baselines/README.md) |
| Bundle generation and channel publication | [`scripts/build.mjs`](scripts/build.mjs), [`scripts/publish.mjs`](scripts/publish.mjs) |

Shared installation types are defined in [`packages/contracts/src/install.ts`](../../packages/contracts/src/install.ts). Client artifact serving and backend client endpoints are in the Worker's [`client.ts`](../worker/src/http/routes/client.ts) and [`client-api.ts`](../worker/src/http/routes/client-api.ts), separate from host-side mutations here.

The [host protocol reference](../../docs/reference/host-protocol.md) covers message and failure semantics; the [user guide](../../docs/guides/using-workshop.md) covers installation and author/reviewer workflows.

The multi-instance scan/preview/confirm protocol replaces the old direct-install messages without a compatibility shim. Its package version is bumped with the protocol cutover so the existing exact-version channel check can reject old client releases after channel publication. A Git merge or bundle build is not channel publication; no production release is performed by this integration.

## Source and output

[`scripts/build.mjs`](scripts/build.mjs) bundles `src/index.ts` into generated `dist/index.js` and writes `dist/manifest.json`. The package version and build-time origin are inputs to that script, not values maintained in this README. Tracked compact baseline data and ignored full extraction output are distinguished in the [baseline README](data/official-card-baselines/README.md).

Scripts are listed in [`package.json`](package.json); existing tests live in [`test/`](test/). Release workflow context remains in the [root deployment overview](../../README.md#部署).
