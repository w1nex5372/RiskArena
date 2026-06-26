# Design Principles

Use this to make UI/UX decisions consistently. It is not a visual style guide.

## Hierarchy

- One primary action per screen should be obvious.
- Secondary actions should be available but quieter.
- Progression, rewards, and next objective should be visible when relevant.

## Layout

- Mobile-first spacing and touch targets.
- Use panels for grouped information and cards for repeated items.
- Avoid nested cards and cluttered modal chains.
- Keep text short; prefer labels, states, and clear CTAs.

## Buttons

- Primary CTAs should use direct verbs.
- Disabled/locked states must explain the next step.
- Combat buttons should prioritize hit area, cooldown state, and action identity.

## Typography And Copy

- Use short fantasy-arena tone without text walls.
- Labels must match real behavior and backend state.
- Do not use "default", "built-in", or similar wording for equipped skills unless the item is actually equipped.

## Skill Cards And Loadout

- Always show role, class restriction, cooldown, effect summary, and equipped state when space allows.
- Preserve Utility / Damage 1 / Damage 2 language from ADR 001.
- Empty slots should tell the player what to equip next.

## Inventory And Shop

- Make ownership, affordability, equip state, and class compatibility clear.
- Do not imply payment, prize, or power advantages unless the underlying system explicitly supports it.

## Battle HUD

- Controls must be readable at a glance.
- Cooldowns, unavailable states, and active feedback must be visible.
- HUD should not obscure combat readability.

## Navigation And New Player Clarity

- New players should know what to do next on every main screen.
- Room entry, training/free arena, first fight, and reward/progression should be straightforward.
