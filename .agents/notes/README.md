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
