# `.agents/` — Project Agent Control Area

This directory contains project-local agent rules, durable notes, skills and shared project resources. It is not product source and not a runtime dump.

- `notes/` is the authority for proposals, decisions, rationale and discussion records. Follow [`notes/AGENTS.md`](notes/AGENTS.md) before adding or moving a note.
- `skills/` contains reusable agent procedures. Follow [`skills/AGENTS.md`](skills/AGENTS.md) before adding or changing a skill.
- `shared/` holds specifications, protocols, schemas and static project data referenced by multiple skills. Create it only when it has an owner.
- Keep runtime state, sessions, logs, caches and generated output outside skills and shared resources. They belong to the relevant task record or runtime storage.

Project documentation lives in `docs/` and follows [`../docs/AGENTS.md`](../docs/AGENTS.md).
