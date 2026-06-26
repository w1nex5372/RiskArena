# Engineering Loop v1.6

Use this loop for autonomous work.

## Root Cause First

Never start with a fix. Follow:

Observe -> Reproduce -> Trace -> Locate root cause -> Estimate implementation -> Implement -> Verify -> Regression.

For UX work, "reproduce" means walking the player flow or code path that creates confusion.

## Autonomous Loop

1. Confirm objective, protected areas, required checks.
2. Classify the task using the Decision Matrix in `ENGINEERING_OS.md`.
3. Search Knowledge Base, relevant ADRs, Gameplay Vision, and Design Principles.
4. Search source with `rg`; read only relevant files.
5. Audit the requested area.
6. Root-cause the issue or UX friction.
7. Rank findings with Impact x Effort = ROI.
8. Spawn only required sub-agents.
9. Implement Priority A.
10. Coordinator review: scope, safety, ADR, gameplay, design, source of truth.
11. Build/check.
12. Validate and code-playtest.
13. Regression review.
14. Update logs/tasks and Knowledge Base if relevant.
15. Decide: repeat for next Priority A or stop.

## Knowledge-First Engineering

Before implementation, search:

- `engineering/KNOWLEDGE_BASE.md`
- relevant `engineering/ADR/*.md`
- `engineering/GAMEPLAY_VISION.md` for gameplay/player-facing work
- `engineering/DESIGN_PRINCIPLES.md` for UI/UX work

If the answer already exists, reuse it. If the task teaches a reusable lesson, append a short Knowledge Base entry.

## Focus Rules

- Work one area at a time: Arena, Boss Raid, lobby, shop/loadout, backend API, gameserver, or QA.
- Do not combine unrelated polish with bug fixes.
- Do not broaden scope because nearby code looks imperfect.
- Keep every change explainable in one or two sentences.

## Multi-Agent Rules

- Give each sub-agent a focused read-only audit unless implementation is explicitly delegated.
- Merge findings into one implementation plan.
- Spawn only roles needed for the classified task.
- Avoid duplicate file reading across agents when a summary is enough.
- QA should verify the final diff, not design the feature.

## Spawn Matrix

- Gameplay: Gameplay Systems, Combat Feel, Frontend if UI-facing, QA, Reviewer.
- UI/UX: UI/UX Designer, Frontend Engineer, QA, Reviewer.
- Backend/API: Backend/Gameserver Engineer, QA, Reviewer.
- Networking/Colyseus: Colyseus/Gameserver Engineer, Backend Engineer if API involved, QA.
- Performance: Performance Engineer, QA, Reviewer.
- Docs-only: Coordinator, Reviewer.

## Stop Conditions

Stop and report when:
- Required context is unavailable.
- The task requires protected systems not authorized by the user.
- A check fails for reasons unrelated to the change and cannot be isolated.
- Continuing would require a large rewrite or product decision.
- No Priority A issues remain and regression risk is acceptable.

## Ask For Clarification

Ask only when a reasonable assumption would risk payment, wallet, data loss, live economy behavior, player rewards, or a large architecture direction.
