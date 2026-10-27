# Documentation Rules

`docs/` contains the current project's human-facing knowledge: what the project is, how it works, and how to use or operate it. Agent guidance remains under `.agents/`; reusable workflows remain under `.agents/skills/`.

## Document homes

Give every durable fact one authoritative home and link to it elsewhere.

- `AGENTS.md`: standing instructions for the directory.
- Source-directory `README.md`: concise, stable AI navigation colocated with the source; scope and maintenance rules live in [the root AGENTS.md](../AGENTS.md#directory-readmes). These are navigation references, not a second home for detailed architecture, contracts or standing instructions.
- Overview and architecture: purpose, boundaries, composition and major flows.
- Tutorials: ordered steps to reach an outcome, including prerequisites and verification.
- References: current behavior, contracts, definitions, configuration and lookup information.
- `docs/plans/`: active plans, checklists, state snapshots and user actions. These are working governance records, not current behavior or API authority.
- `docs/audits/`: audit evidence, findings and reports. They describe a point in time and do not replace a reference.
- `docs/research/`: durable external research with provenance, scope, date/version, verification status and local assessment. Create it only when there is owned content.
- `.agents/notes/`: decision rationale, alternatives, consequences, verification requirements and lifecycle state.
- `.agents/skills/`: reusable agent procedures.
- Runtime records: progress, task status, sessions, logs, caches and generated output. These belong to the relevant task record or runtime storage, not to `docs/`.

Do not create empty category directories in advance. Create a document or subtree when it has owned content.

## Archived documentation

`docs/archived/` contains human-facing documents that no longer describe the current project but remain useful as historical record. Archived documents are not current authority and must not be updated to reflect current behavior; write the current version at its active path. This is separate from `.agents/notes/archived/`, which stores frozen historical notes.

## Content boundaries

- Put detailed current behavior, contracts, architecture and lookup information in `docs/`; source-directory README navigation is the colocated exception defined above.
- Put proposals, design decisions, rejected alternatives and implementation rationale in `.agents/notes/`.
- Put standing instructions in the nearest `AGENTS.md`.
- Put reusable agent procedures in `.agents/skills/`.
- Put current progress, task status, sessions, logs, caches and generated output in task evidence/handoff or existing runtime storage. Place durable reports in their governed document home.
- Do not copy the same fact across tiers; link to its authoritative home.
- External sources and provenance belong under a reference area; durable analysis belongs in `docs/research/` with an index when the directory has multiple reports. Research reports must distinguish external facts, local assessment and project decisions.
- Ongoing discussion records belong under `.agents/notes/discussions/`; `docs/` contains only organized, confirmed project documentation. Do not maintain live discussion-state copies under `docs/`.

A practice observation is not automatically a rule. Keep a one-off observation in the work record; write an incident lesson as a postmortem; record a changed design as an Agent Note; encode a changed agent procedure in a skill.

## Writing rules

- Classify each document as a tutorial or reference before writing it.
- Tutorials establish prerequisites before dependent concepts, follow execution order and end with verification.
- References describe current behavior without pretending to teach a sequence.
- Keep each document within the detail owned by its tree position; link to descendant documents for lower-level detail.
- Document current behavior, not change history. Put rationale and historical narrative in Agent Notes or postmortems.
- Use stable, descriptive, lowercase kebab-case filenames and relative Markdown links.
- Write each document in Chinese or English, using the language chosen when the document was first written; do not maintain parallel language copies.
- Keep one source of truth for every rule, schema and contract.
- For a structural or process change, update the affected project artifact and governing skill in the same change. Record the change in the nearest `AGENTS.md` when it changes standing instructions.
