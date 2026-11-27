# Agent Notes

Agent Notes are durable proposals and decision records. They preserve rationale, alternatives, consequences and required verification. They are not current behavior documentation; current behavior belongs in `docs/`.

## Lifecycle directories

```text
.agents/notes/
├── proposed/       # active proposals and unresolved decisions
├── in-progress/    # accepted decisions being implemented or verified
├── implemented/    # shipped decisions kept current with implementation
├── rejected/       # declined proposals and their rationale
├── archived/       # frozen historical notes
└── discussions/    # ongoing discussion records
```

A note belongs in exactly one lifecycle directory. The directory records lifecycle, not topic. Create a directory when its first note exists; do not create empty category trees in advance.

## Note format

Every non-archived note states at minimum:

- `Status`: `proposed`, `in-progress`, `implemented` or `rejected`
- context or problem
- decision or proposal
- alternatives considered
- consequences and risks
- required verification

Use a stable lowercase kebab-case filename. Link the note to the current document, code owner or contract it affects.

Before creating a note, search active notes for overlap or supersession. A proposal becomes `in-progress/` after acceptance when implementation or verification remains, then `implemented/` after shipping and recording verification. A declined proposal moves to `rejected/` with its reason. A superseded implemented note moves to `archived/` through the archival workflow.

Archived notes are frozen historical evidence and are never edited. Repair inbound links from active documents instead.

## Current notes index

### `implemented/` (shipped on `main`)

- [`pre-launch-hardening-oauth-bridge-and-cdn.md`](implemented/pre-launch-hardening-oauth-bridge-and-cdn.md) — dual-bucket R2 CDN client publishing + atomic `json_set` channel metadata, cross-site CHIPS-partitioned OAuth popup `launch/bind`, TavernHelper child-iframe host bridge, checker auto-publish threat boundary, 98-object FTS `char(0)` sanitization and two-phase `preload`/`delta` cutover guards.
- [`community-access-collections-and-ux-refinement.md`](implemented/community-access-collections-and-ux-refinement.md) — discreet Discord invite touchpoints, versioned policy 3-question quiz gate, author collections & showcase views, five-category consolidation (`规则扩展`), elastic 2K/ultrawide layout and `[工坊]` worldbook marker.
- [`six-category-taxonomy-and-reviewed-cutover.md`](implemented/six-category-taxonomy-and-reviewed-cutover.md) — structured `projectType` / `includedTypes` / ordinary `tags` boundaries, grouped tag filtering and source-pinned offline `taxonomy` review/build/verify tooling (primary enum partially superseded from 6 to 5 categories by the note above).
- [`version-experience-notes-and-recommendations.md`](implemented/version-experience-notes-and-recommendations.md) — private per-version experience/rating notes, read-only unversioned legacy note retention and current-subscription player recommendation eligibility.
- [`new-ui-visual-direction.md`](implemented/new-ui-visual-direction.md) — dark-gold visual direction, 16:9 media ratio, full discovery batch & manual recommendation reading (layout evolved by `community-access-collections-and-ux-refinement.md`).

### `in-progress/` (accepted, implementation deferred)

- [`dual-frontend-migration.md`](in-progress/dual-frontend-migration.md) — long-term shared-backend dual-UI target; classic UI migration and switcher remain intentionally deferred while the new UI ships.

### `proposed/` (pending asset & implementation)

- [`post-intro-ambient-backdrop.md`](proposed/post-intro-ambient-backdrop.md) — post-intro page atmosphere proposal (tentatively Plan 1: pre-blurred tinted backdrop image layer, pending user-supplied image asset).
