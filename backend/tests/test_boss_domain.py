import random

from boss_domain import (
    compute_attack_damage,
    compute_rewards,
    XP_BOSS_HIT,
    XP_DEFEAT_BONUS,
    TOP_DAMAGE_COINS_BONUS,
)

# Boss drops use the FULL loot table (None/uncommon/rare/epic/legendary) — bosses can
# also drop shop-tier items by design. The per-tier probabilities are verified
# separately in test_loot_rates.py; here we pin down compute_rewards' coin/xp/tier shape.
_VALID_TIERS = {None, "uncommon", "rare", "epic", "legendary"}


def test_boss_attack_damage_applies_item_and_boss_percent_bonuses():
    damage = compute_attack_damage(
        random.Random(1),
        flat_bonus=5,
        attack_percent_bonus=0.10,
        boss_damage_percent=0.20,
    )

    assert damage == 18


def test_boss_rewards_coins_xp_and_top_dealer_bonus():
    damage_by_user = {"top": 160, "mid": 80, "low": 20}
    rewards = compute_rewards(damage_by_user, defeated=True, rng=random.Random(31))
    by_user = {r.user_id: r for r in rewards}

    # Coins: damage * 2, with the top damage dealer getting +TOP_DAMAGE_COINS_BONUS.
    assert by_user["top"].coins == int(160 * 2 * (1 + TOP_DAMAGE_COINS_BONUS))
    assert by_user["mid"].coins == 80 * 2
    assert by_user["low"].coins == 20 * 2
    assert by_user["top"].coins > by_user["mid"].coins > by_user["low"].coins

    # XP: damage-scaled + the defeat bonus (defeated=True here).
    for uid, dmg in damage_by_user.items():
        expected_xp = max(1, dmg * XP_BOSS_HIT // 10) + XP_DEFEAT_BONUS
        assert by_user[uid].xp == expected_xp

    # Tier is always a valid loot tier (or None); the concrete item is resolved in the
    # repo layer, so compute_rewards leaves item_drop unset.
    for r in rewards:
        assert r.item_drop_tier in _VALID_TIERS
        assert r.item_drop is None


def test_boss_rewards_omit_defeat_bonus_when_not_defeated():
    rewards = compute_rewards({"solo": 50}, defeated=False, rng=random.Random(7))
    assert rewards[0].xp == max(1, 50 * XP_BOSS_HIT // 10)  # no defeat bonus added


def test_boss_drops_use_full_tier_table_including_shop_tiers():
    # Decision: bosses drop the full table, so shop-tier items (uncommon/rare) CAN drop
    # from a boss — not just the drop-only epic/legendary tiers.
    produced = set()
    for seed in range(3000):
        r = compute_rewards({"u": 100}, defeated=False, rng=random.Random(seed))
        produced.add(r[0].item_drop_tier)
    assert "uncommon" in produced
    assert "rare" in produced
    assert produced <= _VALID_TIERS
