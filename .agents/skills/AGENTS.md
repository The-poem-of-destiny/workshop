# `.agents/skills/` — Skill Organization

Each skill is one directory containing a required `SKILL.md` with valid frontmatter:

```yaml
---
name: kebab-case-name
description: What it does and the distinct branches that should load it.
---
```

- Keep the `name` identical to the directory name.
- Keep the description short: it is always-loaded context. State the capability and the triggers; do not repeat the body.
- Put ordered execution steps in `SKILL.md`. Each step ends with a checkable completion criterion.
- Put branch-specific reference material in a linked file beside the skill. Put shared specifications in `.agents/shared/` instead of copying them into several skills.
- Skill-private scripts, assets and schemas live beside that skill. Use relative paths.
- A skill may be model-invoked or user-invoked. Use `disable-model-invocation: true` when the workflow is deliberate and should not be selected automatically.
- Preserve source and license provenance when adapting external material. Do not copy an external checkout wholesale.
- Keep runtime state, sessions, logs, caches and generated output out of skill directories.

Do not create a second skill for a procedure already owned by an existing skill. Update the owner and its links instead.
