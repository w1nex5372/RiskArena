# Knowledge Base

Reusable discoveries from RiskArena engineering work. Search this before implementation. Add entries only when the lesson will help future agents avoid rediscovery.

## Entry Format

### YYYY-MM-DD - Short Problem

- Problem:
- Root Cause:
- Solution:
- Lesson Learned:

## Entries

### 2026-06-26 - Player-Facing Skill Slots

- Problem: Loadout/HUD clarity was weakened by a hidden/default class skill mixed with equipped skills.
- Root Cause: The old player-facing model implied one built-in class skill plus two equipped slots instead of three explicit equipped battle skills.
- Solution: Use three visible equipped slots: Utility, Damage 1, Damage 2. Keep server-side compatibility fallbacks hidden from player-facing loadout/HUD.
- Lesson Learned: Battle UI should show only what the player intentionally equipped; compatibility defaults belong server-side, not in player-facing slot language.
