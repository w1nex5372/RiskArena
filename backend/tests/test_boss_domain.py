import random

from boss_domain import compute_attack_damage, compute_rewards


def test_boss_attack_damage_applies_item_and_boss_percent_bonuses():
    damage = compute_attack_damage(
        random.Random(1),
        flat_bonus=5,
        attack_percent_bonus=0.10,
        boss_damage_percent=0.20,
    )

    assert damage == 18


def test_boss_rewards_only_drop_epic_or_legendary_tiers():
    rewards = compute_rewards(
        {"top": 160, "mid": 80, "low": 20},
        defeated=True,
        rng=random.Random(31),
    )

    by_user = {reward.user_id: reward for reward in rewards}
    assert by_user["top"].item_drop_tier == "legendary"
    assert by_user["mid"].item_drop_tier == "epic"
    assert by_user["low"].item_drop_tier is None
    assert by_user["top"].coins > by_user["mid"].coins
