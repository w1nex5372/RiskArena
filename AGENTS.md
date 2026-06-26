# RiskArena Agent Entrypoint

Read this first for every AI-agent task in this repo.

## Read First

1. `AGENTS.md`
2. `engineering/ENGINEERING_OS.md`
3. Only the engineering docs relevant to the task:
   - Loop/review work: `engineering/ENGINEERING_LOOP.md`, `engineering/REVIEW_PROCESS.md`
   - Gameplay/player-facing work: `engineering/GAMEPLAY_VISION.md`, `engineering/DESIGN_PRINCIPLES.md`, `engineering/PLAYTEST_GUIDE.md`
   - Role planning: `engineering/AGENT_ROLES.md`
   - Token control: `engineering/TOKEN_RULES.md`
   - Known lessons: `engineering/KNOWLEDGE_BASE.md`
   - Architecture decisions: relevant `engineering/ADR/*.md`
4. `CLAUDE.md` only when architecture or commands are needed.
5. Only the source files directly relevant to the task.

## Default Rules

- Use `rg`/search before opening files.
- Open only relevant files; do not browse unrelated folders.
- Keep changes scoped to the user request.
- Do not touch payment, Solana, bot, fake-player, economy, combat balance, or database behavior unless the task explicitly says so.
- Do not rewrite systems when a focused fix will work.
- Check relevant ADRs, Gameplay Vision, Design Principles, and Knowledge Base before implementation.
- Preserve existing user changes in the worktree.
- Run the smallest meaningful checks for the work done.

## Logs And Tasks

Update `DEV_LOG.md` and `TASKS.md` when the work changes behavior, fixes a bug, creates a new known issue, or changes the recommended next task. Keep entries short and dated.

## Final Reports

Summarize files changed, checks run, risks, and the next safest task. Do not paste large file contents.
