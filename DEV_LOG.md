# DEV_LOG

Chronological engineering notes. Add short dated entries when work changes behavior, fixes a bug, creates a known issue, or changes recommended follow-up.

## Template

### YYYY-MM-DD - Short Title

- Scope:
- Changed:
- Checks:
- Risks:
- Next:

### 2026-06-26 - Engineering OS v1

- Scope: Added project-local AI engineering workflow documentation.
- Changed: Created agent entrypoint, role guide, loop, review, playtest, token rules, and task/log templates.
- Checks: `git diff --check`.
- Risks: Documentation-only change; no app behavior changed.
- Next: Use the OS for focused gameplay, UX, gameserver, and QA passes.

### 2026-06-26 - Engineering OS v1.6

- Scope: Finalized the project-local AI engineering operating system.
- Changed: Added Knowledge Base, ADRs, Gameplay Vision, Design Principles, and compliance checks in loop/review/token/role docs.
- Checks: `git diff --check`.
- Risks: Documentation-only change; no app behavior changed.
- Next: Future agents should search relevant Knowledge Base/ADR/design/gameplay docs before implementation.
