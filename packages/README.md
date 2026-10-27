# Shared packages

Shared API shapes, domain rules, and content analysis used by the [applications](../apps/README.md).

| Area | Responsibility and boundary | Entry points |
| --- | --- | --- |
| `contracts` | Zod schemas and TypeScript types for API requests, responses, and distribution records. Defines exchanged data, not HTTP handlers or persistence; depends on `domain` where shared rules are needed. | [Public exports](contracts/src/index.ts), [package exports](contracts/package.json) |
| `domain` | Runtime-independent rules and transformations: taxonomy, metadata, content acceptance and entry identity, images, limits, and versions. No application storage or network orchestration. | [Public exports](domain/src/index.ts), [content policy](domain/src/content-policy.ts), [entry extraction and comparison](domain/src/project-content.ts) |
| `content` | EJS/worldbook/regex analysis, check reports, and external-link collection. Owns checker implementation and distributable checker bundles, not the application's submission/review lifecycle. | [Public exports](content/src/index.mjs), [type declarations](content/src/index.d.ts), [package subpaths](content/package.json), [checker entry](content/src/ejs-checker/index.mjs) |

For checker artifacts, the [build script](content/scripts/build.mjs) produces browser/worker bundles and updates the [source bundle manifest](content/src/bundle-manifest.json). The separate [publisher](content/scripts/publish-checker.mjs) writes bundles to remote R2; building and publishing are distinct operations.

Application integration lives under [Worker source](../apps/worker/src/) and the [Tavern client](../apps/tavern-client/). Repository setup and command entry points are in the [root README](../README.md) and [root package scripts](../package.json).
