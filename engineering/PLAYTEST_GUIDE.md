# Playtest Guide

Use code-based playtests and focused manual notes to verify player-facing work.

## Required Standard

Every gameplay or player-facing change should answer:

- Can a new player understand it?
- Is the next objective obvious?
- Does combat feel clearer or better?
- Does the UI explain itself without a text wall?
- Is class identity preserved?
- Are mobile controls still comfortable?
- Would this improve retention?

## Mobile Player Flow

- New user sees next objective.
- Primary CTA is visible without hunting.
- Touch targets are large enough for mobile.
- Critical labels fit on small screens.
- Telegram Mini App safe areas are respected.

## Arena Checks

- Room entry path is clear.
- HUD controls match equipped skills and available actions.
- Attack/block/skill feedback is readable.
- Cooldowns and disabled states are visible.
- End-of-fight result and next action are clear.

## Boss Raid Checks

- Entry and readiness states are understandable.
- Boss HP, player HP/guard, and cooldown feedback are visible.
- Skill buttons send the intended ability.
- Defeat/victory/reward states are understandable.

## Skills, Loadout, Shop

- Equipped slots map to actual backend slots.
- Skill role, class restriction, cooldown, and effect summary are visible.
- Empty slots explain what to do next.
- Shop equip states match inventory/loadout state.
- No hidden/default skill is presented as equipped unless actually equipped.

## New Player Clarity

- Choose/create character is obvious.
- Training/free arena entry is obvious.
- First battle controls are discoverable.
- Rewards/progression are visible after play.

## Notes Format

Record:
- Scenario
- Expected result
- Observed result
- File or code path checked
- Remaining risk

## Regression Targets

- First-session flow: auth/fallback, character, home, room, arena, first reward.
- Arena: enter, fight, use skills, block/attack feedback, finish.
- Boss Raid: enter, use skills, damage/readiness feedback, result.
- Skills/shop/loadout: equip state, empty state, cooldown/effect/class labels.
- Mobile: small viewport labels, touch targets, safe-area spacing.
