# Applications

Two runtime surfaces share the contracts, domain rules and content tooling in [`../packages/`](../packages/):

| Surface | Responsibility | Start here |
| --- | --- | --- |
| Worker + Web | Backend API, persistence, content processing and distribution; also hosts the React site through Cloudflare Static Assets. | [`worker/README.md`](worker/README.md) |
| Tavern client | Script running inside SillyTavern; opens the Workshop site and bridges installation operations to host APIs. Not another backend or a separate copy of the site. | [`tavern-client/README.md`](tavern-client/README.md) |

For browser-to-host installation work, follow both the [Web bridge](worker/web/src/lib/install-bridge.ts) and the [Tavern runtime](tavern-client/src/index.ts). Shared installation shapes are in [`packages/contracts/src/install.ts`](../packages/contracts/src/install.ts).

Workspace commands and deployment overview remain in the [root README](../README.md); application scripts live in each application's `package.json`.
