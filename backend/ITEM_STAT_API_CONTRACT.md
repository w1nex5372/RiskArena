# Item Stat API Contract

Frontend item views should render backend-provided fields and should not recompute enchant combat math.

Every serialized item from `/shop/items`, `/me/inventory`, `/me/equipped`, and `/me/upgrade` includes:

- `enchant_level`: owned copy enchant level; shop items default to `0`.
- `base_stats`: catalog flat stats before enchant and passives.
- `enchant_stats`: stat contribution from the current enchant level only.
- `passive_stats`: structured passive contribution, keyed by passive stat name.
- `effective_stats`: total authoritative contribution for that item copy, including base stats, enchant stats, and passive stats.
- `passive_label`: display text for the passive, or `""`.
- `stat_summary`: render-ready stat rows with `stat`, `value`, and `label`.

`/me/equipped` also includes:

- `equipped.weapon`, `equipped.armor`, `equipped.ability`: full serialized equipped item copies.
- `equipped_items`: compact equipped copy identifiers for duplicate handling.
- `loadout_effective_stats`: aggregate authoritative equipped modifiers used by combat.

`/me/upgrade` also includes per item:

- `max_enchant`
- `normal_success_chance`
- `blessed_success_chance`
- `next_enchant_preview.normal_scroll`
- `next_enchant_preview.blessed_scroll`

Each `next_enchant_preview` includes `current_stats`, `next_enchant_stats`, `next_effective_stats`, `delta_stats`, `success_chance`, `max_enchant`, `can_destroy`, `failure_behavior`, and `at_max`.
