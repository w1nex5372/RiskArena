# ADR 001: Three Equipped Battle Skills

## Status

Accepted

## Decision

RiskArena uses three player-facing equipped battle skill slots:

- Utility
- Damage 1
- Damage 2

There is no player-facing hidden/default class skill slot. Any server-side fallback for compatibility must not be presented as an equipped skill.

## Why

Players need to understand exactly which battle actions they chose. A hidden class skill makes the loadout, shop, and HUD harder to reason about and weakens mobile clarity.

## Tradeoffs

- Clearer loadout ownership and battle HUD mapping.
- Requires all skill UI to preserve Utility / Damage 1 / Damage 2 language.
- Existing compatibility fallbacks may still exist internally, but must stay invisible to player-facing equipment state.

## Consequences

- Shop, inventory, loadout, Arena HUD, and Boss Raid HUD should describe the same three-slot model.
- Future skill work must not reintroduce "built-in", "default", or class-skill language as an equipped player slot.
- New skill systems should extend the explicit slot model or create a new ADR.
