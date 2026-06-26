# Agent Roles

Use these roles to divide focused work. A single agent may hold multiple roles, but each role should keep its scope narrow.

## Coordinator

- Ownership: task framing, decision classification, ROI priority, sub-agent selection, scope control, sequencing, compliance, final report.
- Inspect: `AGENTS.md`, relevant engineering docs, relevant ADRs, Knowledge Base entries, `DEV_LOG.md`, `TASKS.md`, user request.
- Do not touch: implementation files unless also acting as an implementation role.
- Required: prevent scope creep, duplicate work, overengineering, and protected-system drift.
- Required: check ADR, Gameplay Vision, and Design Principles compliance before implementation and final report.
- Required: record lessons learned in `KNOWLEDGE_BASE.md` when useful.
- Output: objective, protected areas, Priority A/B/C matrix, sub-agent plan, compliance notes, checks required, final status.

## Gameplay Systems Engineer

- Ownership: rules, abilities, combat readability, progression-facing systems.
- Inspect: shared configs, gameserver shared logic, focused frontend labels if values are displayed.
- Do not touch: payments, economy, bots, unrelated UI polish.
- Output: exact rule/config impact, risks, checks.

## Combat Feel/VFX Engineer

- Ownership: hit feedback, animations, ability identity, readability.
- Inspect: arena scenes, combat effects, HUD event mapping, ability metadata.
- Do not touch: damage formulas, rewards, wallet/payment code.
- Output: visual/feedback changes and playtest notes.

## UI/UX Designer

- Ownership: mobile clarity, hierarchy, CTAs, onboarding, screen flow.
- Inspect: target components, design patterns already used, responsive layout.
- Do not touch: backend behavior, combat math, payment/economy.
- Output: UX issue, player impact, implemented UI change, mobile notes.

## Frontend Engineer

- Ownership: React state, API integration, HUD, shop/loadout/inventory/lobby screens.
- Inspect: focused components, shared frontend utilities, API client calls.
- Do not touch: backend schema or gameserver logic unless task requires.
- Output: component changes, state flow, frontend build result.

## Backend/Gameserver Engineer

- Ownership: FastAPI APIs, Colyseus rooms, server-side validation, persistence flow.
- Inspect: exact route/room/schema/shared files in scope.
- Do not touch: Solana/payment, bots, economy, broad DB behavior unless explicit.
- Output: API/server flow, compatibility, build/compile results.

## Colyseus/Gameserver Engineer

- Ownership: room lifecycle, schemas, messages, authoritative server behavior, reconnect/readiness flow.
- Inspect: exact Colyseus room, schema, shared config, and matching frontend event path.
- Do not touch: backend payment/economy, combat balance, unrelated UI.
- Output: message flow, server validation, compatibility, gameserver build result.

## Performance Engineer

- Ownership: render/runtime hotspots, payload size, loop frequency, avoidable re-renders, server tick cost.
- Inspect: only measured or suspected hot paths.
- Do not touch: gameplay rules, economy, payment, broad architecture without evidence.
- Output: measurement, bottleneck, smallest optimization, regression risk.

## QA Engineer

- Ownership: checks, regression risk, acceptance criteria.
- Inspect: diff, requested checks, relevant scripts, known dirty files.
- Do not touch: feature code unless fixing test failures caused by the task.
- Output: pass/fail matrix, failures, residual risk.

## Playtest Engineer

- Ownership: code-based playtest scenarios and manual verification notes.
- Inspect: player flow, HUD inputs, room entry, shop/loadout, Boss Raid/Arena paths.
- Do not touch: product rules unless asked.
- Output: scenario list, observed expected behavior, gaps.

## Code Reviewer

- Ownership: review quality, bug risk, unrelated changes, maintainability.
- Inspect: diff and nearby context.
- Do not touch: code unless asked to fix findings.
- Output: findings first, file/line references, risk level, test gaps.

## Spawn Guidance

- Use the minimum useful roles.
- Do not spawn audit agents for docs-only or trivial changes.
- For multi-area features, audit with specialists first, then let the Coordinator choose one implementation path.
- QA and Reviewer are final gates for code changes.
