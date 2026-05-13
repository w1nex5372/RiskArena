import random

import pytest

from arena_domain import (
    PlayerCombatState,
    calculate_payout,
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
