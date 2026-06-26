# RiskArena Engineering OS v1.6

This is the project-local execution framework for Claude/Codex agents working on RiskArena. The Coordinator owns scope, sequencing, review, and completion. Use this OS for frontend, Colyseus gameserver, backend, lobby, shop, skills, Boss Raid, QA, and polish tasks.

## Standard Execution Pipeline

Every task follows this pipeline:

1. Understand objective: goal, restrictions, acceptance criteria, protected systems.
2. Read project context: `AGENTS.md`, this file, only relevant engineering docs, relevant ADRs, relevant Knowledge Base entries, `DEV_LOG.md`, `TASKS.md`, and `CLAUDE.md` only when needed.
3. Audit only the requested area with `rg` first.
4. Knowledge check: search `KNOWLEDGE_BASE.md`, relevant ADRs, `GAMEPLAY_VISION.md`, and `DESIGN_PRINCIPLES.md`.
5. Root Cause Analysis: observe, reproduce, trace, locate root cause.
6. Create Priority Matrix: Impact x Effort = ROI; rank A/B/C.
7. Spawn specialized sub-agents only when useful.
8. Implementation: complete Priority A first with the smallest coherent change.
9. Internal Coordinator Review: inspect diff, scope, safety, ADR, gameplay, and design compliance.
10. Build: run required and area-appropriate builds/tests.
11. Validation: verify behavior against acceptance criteria.
12. Code-based Playtest: use scripts, local flow checks, or precise manual notes.
13. Regression Check: protect adjacent flows and known source-of-truth values.
14. Update `DEV_LOG.md` when relevant.
15. Update `TASKS.md` when relevant.
16. Update `KNOWLEDGE_BASE.md` when a reusable lesson was learned.
17. Final Summary: concise files, changes, checks, risks, next task.
18. Decide whether another iteration is required.

## Decision Matrix

Classify before implementation: Gameplay, Combat Feel, UI, UX, Backend, Networking, Performance, Content, Art, Architecture, Data, or Infrastructure. The classification selects owners from `AGENT_ROLES.md` and the checks to run.

## ROI Priority Matrix

- Priority A: highest player/business impact for reasonable effort; implement first.
- Priority B: good improvement; implement after A or record in `TASKS.md`.
- Priority C: future polish; record only if useful.

Estimate Impact and Effort as Low/Medium/High. Do not implement C while A remains.

## Definition Of Done

A task is not complete until:

- Relevant ADRs, Knowledge Base entries, Gameplay Vision, and Design Principles were checked.
- Required build/checks pass or failures are clearly unrelated.
- Required tests pass.
- Code-based playtest is completed when behavior/player flow changed.
- Regression review is completed.
- Protected systems are untouched.
- Coordinator review is completed.
- No obvious UX or gameplay regression remains.

## Permanent Knowledge Files

- `engineering/KNOWLEDGE_BASE.md`: reusable discoveries; append only non-duplicate lessons.
- `engineering/ADR/`: accepted architecture decisions; do not violate without Coordinator justification.
- `engineering/GAMEPLAY_VISION.md`: gameplay direction guardrails.
- `engineering/DESIGN_PRINCIPLES.md`: UI/UX decision guardrails.

## Safety Defaults

- Payment, Solana, bot/fake-player, economy, combat balance, and database behavior are protected areas unless explicitly requested.
- Do not add gambling, prize, wallet, or pay-to-win mechanics as part of unrelated work.
- Prefer targeted fixes over architecture rewrites.
- If a repo area is already dirty, work with it and do not revert unrelated changes.
