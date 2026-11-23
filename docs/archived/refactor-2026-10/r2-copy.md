# R2 asset copy adapter

`tools/migrate/r2-copy.mjs` copies migration assets into the target key space with per-object SHA-256 verification, idempotent resume, and a local rehearsal mode. It never infers buckets.

## Build a manifest

From a transformed migration target:

```bash
node tools/migrate/r2-copy.mjs --target /tmp/workshop-migration.json
# writes /tmp/workshop-migration.json.r2.json
```

Each manifest entry declares `sourceKey`, `targetKey`, `sha256`, `bytes`. `sourceKey` comes from the legacy asset row; if absent it falls back to the target key.

## Local rehearsal

```bash
node tools/migrate/r2-copy.mjs \
  --manifest /tmp/workshop-migration.json.r2.json \
  --source-dir /tmp/legacy-r2 \
  --target-dir /tmp/target-r2
```

The second run copies zero objects. A corrupted target file is detected and repaired. Missing source files are skipped so a partial export can be resumed; `verify`/`reconcile` still report missing assets separately.

## Remote copy

```bash
node tools/migrate/r2-copy.mjs \
  --manifest /tmp/workshop-migration.json.r2.json \
  --source-bucket <legacy-bucket> \
  --target-bucket <target-bucket> \
  --apply
```

Without `--apply` it prints a dry-run summary. `--apply` reads each source object through `wrangler r2 object get`, verifies bytes/SHA, uploads with `wrangler r2 object put`, then downloads the target and verifies again. Existing target objects with matching bytes/SHA are skipped.

## Boundaries

- No bucket names are inferred from config; pass both explicitly.
- Real backup import requires an authorized target and is not run by this repository's default checks.
- Manifest-only tests live in `tools/migrate/test.mjs`; they cover validation, idempotence, and repair.
