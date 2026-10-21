# AGENTS.md — Agent Notes

Agent Notes are durable proposals and decision records that preserve rationale, alternatives, consequences and required verification. Follow the [documentation standard](../../docs/AGENTS.md) and the [note format](README.md).

## Lifecycle

- `proposed/` — active proposals and unresolved decisions.
- `in-progress/` — accepted decisions being implemented or verified.
- `implemented/` — shipped decisions kept current with implementation.
- `rejected/` — declined proposals and rationale.
- `archived/` — frozen historical notes.
- `discussions/` — ongoing discussion records.

Keep one note in one lifecycle directory. The directory records lifecycle, not topic. Create a directory when its first note exists.

## Rules

- Check active notes for the same decision, mechanism or rejected alternative before creating a note.
- Classify full and partial supersession explicitly. Keep partial supersessions active and cross-linked; archive a fully superseded note set in the same change.
- Preserve the historical body and original language when archiving. Archived notes are frozen: never edit them and never treat them as current authority.
- Record the current owner, unique rationale, alternatives, consequences, verification requirement and affected documents or code.
- Repair inbound links from active documents when a note moves.
- Ongoing discussion state belongs under `discussions/`. Once settled, move confirmed current behavior into `docs/` and durable rationale into an Agent Note; do not maintain a second authority in the discussion record.
- Do not store runtime state, task progress, sessions, logs or generated output here. Those belong to the relevant task record or runtime storage.
