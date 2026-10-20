# Configuration sources of truth

This directory contains cross-runtime product configuration that must be shared by the SillyTavern client bundle and the Workshop Worker.

## `workshop.json`

This is the single source of truth for:

- `client.stable`: latest released Creative Workshop client tag; production requires this exact version.
- `client.staging`: active staging-client version.
- The staging site and its aliases require this exact staging version. Other or unknown versions must update before DLC operations; no separate minimum version is supported.
- `client.publicPath`: stable client bundle path.
- `client.stagingPublicPath`: staging client bundle path.
- `client.migrations`: one-time client import-path migrations shown to affected old clients.
- production/staging Workshop endpoints and staging aliases.
- known companion-script dependency display names and latest versions.

Do not duplicate these values in UI, client, Worker, tests, release docs, or deployment scripts. Import/read this manifest instead.

## What does not belong here

Do not turn every implementation constant into global config.

Server-only domain configuration already has its own single source:
- project taxonomy: `packages/domain/src/taxonomy.ts`
- project content policy: `packages/domain/src/content-policy.ts`
- upload/request/banner limits: `packages/domain/src/limits.ts`
- DLC/project semantic-version helpers: `packages/domain/src/version.ts`
- discovery/ranking parameters: `apps/worker/src/storage/home.ts`

Implementation constants such as polling intervals, DOM storage keys, protocol namespaces, cache TTLs, and UI timing values stay near the code unless they are duplicated or become operator-tuned settings.

See `AGENTS.md` for the rule on deciding whether a literal belongs in configuration.
