import random

import pytest

from arena_domain import (
    ItemModifiers,
    PlayerCombatState,
    calculate_payout,
    class_modifiers_for,
    combine_modifiers,
    normalize_action,
    resolve_round,
)


def p(user_id, hp=100, ability_used=False):
    return PlayerCombatState(user_id=user_id, hp=hp, ability_used=ability_used)


def test_invalid_action_is_rejected():
    with pytest.raises(ValueError):
        normalize_action("dance")


def test_attack_vs_attack_damages_both_players():
    result = resolve_round(p("p1"), p("p2"), "attack", "attack", 1, random.Random(1))

    assert result.status == "active"
    assert result.player_one_hp == 80
    assert result.player_two_hp == 80
    assert result.winner_user_id is None


def test_defend_halves_incoming_damage():
    result = resolve_round(p("p1"), p("p2"), "defend", "attack", 1, random.Random(1))

    assert result.player_one_hp == 90
    assert result.player_two_hp == 100


def test_ability_marks_used_and_falls_back_to_attack_after_use():
    first = resolve_round(p("p1"), p("p2"), "ability", "defend", 1, random.Random(1))
    second = resolve_round(
        p("p1", hp=first.player_one_hp, ability_used=first.player_one_ability_used),
        p("p2", hp=first.player_two_hp, ability_used=first.player_two_ability_used),
        "ability",
        "defend",
        2,
        random.Random(1),
    )

    assert first.player_two_hp == 85
    assert first.player_one_ability_used is True
    assert second.player_two_hp == 75


def test_risk_can_deal_damage_or_self_damage_deterministically_with_injected_rng():
    success = resolve_round(p("p1"), p("p2"), "risk", "defend", 1, random.Random(1))
    failure = resolve_round(p("p1"), p("p2"), "risk", "defend", 1, random.Random(2))

    assert success.player_two_hp == 83
    assert success.player_one_hp == 100
    assert failure.player_two_hp == 100
    assert failure.player_one_hp == 85


def test_warrior_class_adds_attack_damage_and_extra_hp():
    warrior_mods = class_modifiers_for("warrior")

    result = resolve_round(
        p("p1", hp=100 + warrior_mods.hp_bonus),
        p("p2"),
        "attack",
        "attack",
        1,
        random.Random(1),
        player_one_modifiers=warrior_mods,
    )

    assert warrior_mods == ItemModifiers(attack_bonus=3, hp_bonus=15)
    assert result.player_one_hp == 95
    assert result.player_two_hp == 77


def test_mage_class_boosts_ability_damage_and_has_lower_hp():
    mage_mods = class_modifiers_for("mage")

    result = resolve_round(
        p("p1", hp=100 + mage_mods.hp_bonus),
        p("p2"),
        "ability",
        "attack",
        1,
        random.Random(1),
        player_one_modifiers=mage_mods,
    )

    assert mage_mods == ItemModifiers(ability_bonus=8, hp_bonus=-10)
    assert result.player_one_hp == 70
    assert result.player_two_hp == 62


def test_rogue_class_increases_risk_success_chance():
    baseline = resolve_round(p("p1"), p("p2"), "risk", "defend", 1, random.Random(5))
    rogue = resolve_round(
        p("p1"),
        p("p2"),
        "risk",
        "defend",
        1,
        random.Random(5),
        player_one_modifiers=class_modifiers_for("rogue"),
    )

    assert baseline.player_two_hp == 100
    assert baseline.player_one_hp == 85
    assert rogue.player_two_hp == 83
    assert rogue.player_one_hp == 100


def test_class_and_item_modifiers_stack_cleanly():
    combined = combine_modifiers(
        class_modifiers_for("warrior"),
        ItemModifiers(attack_bonus=5, hp_bonus=10),
    )

    result = resolve_round(
        p("p1", hp=100 + combined.hp_bonus),
        p("p2"),
        "attack",
        "defend",
        1,
        random.Random(1),
        player_one_modifiers=combined,
    )

    assert combined.attack_bonus == 8
    assert combined.hp_bonus == 25
    assert result.player_one_hp == 125
    assert result.player_two_hp == 86


def test_attack_percent_passive_increases_damage():
    result = resolve_round(
        p("p1"),
        p("p2"),
        "attack",
        "defend",
        1,
        random.Random(1),
        player_one_modifiers=ItemModifiers(bonus_attack_percent=0.25),
    )

    assert result.player_two_hp == 88


def test_enchanted_weapon_modifier_changes_arena_damage():
    result = resolve_round(
        p("p1"),
        p("p2"),
        "attack",
        "defend",
        1,
        random.Random(1),
        player_one_modifiers=ItemModifiers(attack_bonus=10, bonus_attack_percent=0.10),
    )

    assert result.player_two_hp == 84


def test_lifesteal_passive_restores_hp_after_damage():
    result = resolve_round(
        p("p1", hp=60),
        p("p2"),
        "attack",
        "defend",
        1,
        random.Random(1),
        player_one_modifiers=ItemModifiers(lifesteal_percent=0.5),
    )

    assert result.player_one_hp == 65
    assert result.details["player_one_lifesteal"] == 5


def test_knockout_sets_winner():
    result = resolve_round(p("p1"), p("p2", hp=10), "attack", "defend", 1, random.Random(1))

    assert result.status == "finished"
    assert result.winner_user_id == "p1"


def test_double_ko_is_draw():
    result = resolve_round(p("p1", hp=10), p("p2", hp=10), "attack", "attack", 1, random.Random(1))

    assert result.status == "draw"
    assert result.winner_user_id is None


def test_max_rounds_equal_hp_draw_and_higher_hp_wins():
    draw = resolve_round(p("p1", hp=50), p("p2", hp=50), "defend", "defend", 20, random.Random(1))
    win = resolve_round(p("p1", hp=51), p("p2", hp=50), "defend", "defend", 20, random.Random(1))

    assert draw.status == "draw"
    assert win.status == "finished"
    assert win.winner_user_id == "p1"


def test_payout_winner_takes_most_and_burns_remainder():
    payout = calculate_payout(101, "finished")

    assert payout["pot"] == 202
    assert payout["winner_payout"] == 181
    assert payout["burn_amount"] == 21
    assert payout["refund_each"] == 0


def test_draw_refunds_each_stake_and_burns_nothing():
    payout = calculate_payout(100, "draw")

    assert payout == {"pot": 200, "winner_payout": 0, "burn_amount": 0, "refund_each": 100}
