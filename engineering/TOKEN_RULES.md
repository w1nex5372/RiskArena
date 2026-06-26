# Token Rules

Use tokens like an engineering budget.

## Coordinator Defaults

- Read only files required by the current objective.
- Search first, then open the smallest useful file section.
- Do not inspect unrelated folders for "context."
- Do not read every engineering document by default.
- Prefer implementation and verification over long discussion.
- Keep reports short unless the user requests a full audit.

## Read Set

Always read:
- `AGENTS.md`
- `engineering/ENGINEERING_OS.md`

Read only when relevant:
- `engineering/ENGINEERING_LOOP.md`
- `engineering/AGENT_ROLES.md`
- `engineering/REVIEW_PROCESS.md`
- `engineering/PLAYTEST_GUIDE.md`
- `engineering/TOKEN_RULES.md`
- `engineering/GAMEPLAY_VISION.md`
- `engineering/DESIGN_PRINCIPLES.md`
- relevant `engineering/ADR/*.md`
- relevant `engineering/KNOWLEDGE_BASE.md` entries
- `CLAUDE.md` for architecture/commands
- relevant source files

## Search First

- Use `rg` or `rg --files` before opening files.
- Search exact symbols, labels, routes, events, and file names.
- Prefer targeted line reads over whole-file reads.

## Read Narrowly

- Open only files relevant to the current task.
- Do not inspect unrelated folders.
- Do not paste full files into reports.
- Summarize findings with file paths and short explanations.

## Edit Narrowly

- Keep patches small.
- Avoid drive-by refactors.
- Avoid duplicate constants or conflicting source-of-truth values.
- Reuse existing architecture and local helpers.
- Do not add docs or abstractions that the task does not need.

## Report Concisely

- List files changed.
- List checks run and result.
- Mention only meaningful risks.
- Keep final responses short unless the user requests detail.

## Sub-Agent Budget

- Spawn agents only when they reduce risk or speed up focused audits.
- Give sub-agents narrow file/path scopes.
- Summarize sub-agent findings; do not paste their full output.
