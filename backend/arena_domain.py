"""
Arena domain rules for the 1v1 Duel MVP.

This module is intentionally independent from FastAPI and PostgreSQL so the
server-authoritative combat rules can be unit-tested without a database.
"""
from dataclasses import dataclass
from enum import Enum
import random
from typing import Dict, Optional, Tuple


class ArenaAction(str, Enum):
    ATTACK = "attack"
    DEFEND = "defend"
    ABILITY = "ability"
    RISK = "risk"


VALID_ACTIONS = {action.value for action in ArenaAction}
STARTING_HP = 100
ATTACK_DAMAGE = 20
ABILITY_DAMAGE = 30
RISK_DAMAGE = 35
RISK_SELF_DAMAGE = 15
DEFEND_REDUCTION = 0.5
MAX_ROUNDS = 20
WINNER_PAYOUT_BPS = 9000


@dataclass(frozen=True)
class PlayerCombatState:
    user_id: str
    hp: int
    ability_used: bool = False


@dataclass(frozen=True)
class RoundResolution:
    player_one_hp: int
    player_two_hp: int
    player_one_ability_used: bool
    player_two_ability_used: bool
    status: str
    winner_user_id: Optional[str]
    resolution: str
    details: Dict


@dataclass(frozen=True)
class ItemModifiers:
    attack_bonus: int = 0
    ability_bonus: int = 0
    defend_reduction: float = 0.0   # subtracted from pass-through multiplier → less damage gets through
    risk_win_chance: float = 0.0    # added to 0.5 base win probability
    hp_bonus: int = 0               # added to STARTING_HP at match creation


# Weapon / ability rarity → combat bonuses applied each round.
# defend_reduction and hp_bonus are not set here — armor uses ARMOR_HP_BONUS.
RARITY_MODIFIERS: Dict[str, ItemModifiers] = {
    "Common":    ItemModifiers(attack_bonus=2),
    "Rare":      ItemModifiers(attack_bonus=5),
    "Epic":      ItemModifiers(attack_bonus=8,  ability_bonus=5),
    "Legendary": ItemModifiers(attack_bonus=12, ability_bonus=10, risk_win_chance=0.1),
}

# Armor rarity → flat HP added to STARTING_HP at match creation.
ARMOR_HP_BONUS: Dict[str, int] = {
    "Common":    10,
    "Rare":      20,
    "Epic":      35,
    "Legendary": 50,
}

_NO_MODIFIERS = ItemModifiers()


def apply_modifiers(base_action_result: Dict, modifiers: ItemModifiers) -> Dict:
    """Merge modifier bonuses into a base stats dict (keys: 'attack', 'ability', 'starting_hp')."""
    result = dict(base_action_result)
    if modifiers.attack_bonus:
        result["attack"] = result.get("attack", ATTACK_DAMAGE) + modifiers.attack_bonus
    if modifiers.ability_bonus:
        result["ability"] = result.get("ability", ABILITY_DAMAGE) + modifiers.ability_bonus
    if modifiers.hp_bonus:
        result["starting_hp"] = result.get("starting_hp", STARTING_HP) + modifiers.hp_bonus
    return result


def normalize_action(action: str) -> str:
    normalized = (action or "").strip().lower()
    if normalized not in VALID_ACTIONS:
        raise ValueError("Invalid arena action")
    return normalized


def _incoming_damage(
    action: str,
    ability_available: bool,
    rng: random.Random,
    modifiers: Optional[ItemModifiers] = None,
) -> Tuple[int, bool, int]:
    """Return (outgoing_damage, ability_used_now, self_damage)."""
    mod = modifiers or _NO_MODIFIERS
    if action == ArenaAction.ATTACK.value:
        return ATTACK_DAMAGE + mod.attack_bonus, False, 0
    if action == ArenaAction.DEFEND.value:
        return 0, False, 0
    if action == ArenaAction.ABILITY.value:
        if not ability_available:
            # ability already spent — fall back to a basic attack with weapon bonus
            return ATTACK_DAMAGE + mod.attack_bonus, False, 0
        return ABILITY_DAMAGE + mod.ability_bonus, True, 0
    if action == ArenaAction.RISK.value:
        win_chance = min(0.9, 0.5 + mod.risk_win_chance)
        if rng.random() < win_chance:
            return RISK_DAMAGE, False, 0
        return 0, False, RISK_SELF_DAMAGE
    raise ValueError("Invalid arena action")


def resolve_round(
    player_one: PlayerCombatState,
    player_two: PlayerCombatState,
    player_one_action: str,
    player_two_action: str,
    round_number: int,
    rng: Optional[random.Random] = None,
    player_one_modifiers: Optional[ItemModifiers] = None,
    player_two_modifiers: Optional[ItemModifiers] = None,
) -> RoundResolution:
    rng = rng or random.SystemRandom()
    p1_mod = player_one_modifiers or _NO_MODIFIERS
    p2_mod = player_two_modifiers or _NO_MODIFIERS
    p1_action = normalize_action(player_one_action)
    p2_action = normalize_action(player_two_action)

    p1_damage, p1_used_ability_now, p1_self_damage = _incoming_damage(
        p1_action, not player_one.ability_used, rng, p1_mod
    )
    p2_damage, p2_used_ability_now, p2_self_damage = _incoming_damage(
        p2_action, not player_two.ability_used, rng, p2_mod
    )

    # Defender's armor reduces the damage pass-through.
    # Formula: pass_through = max(0.0, 1 - DEFEND_REDUCTION - mod.defend_reduction)
    # Default (no armor): 1 - 0.5 - 0.0 = 0.5 → same as before.
    if p1_action == ArenaAction.DEFEND.value:
        pass_through = max(0.0, 1.0 - DEFEND_REDUCTION - p1_mod.defend_reduction)
        p2_damage = int(p2_damage * pass_through)
    if p2_action == ArenaAction.DEFEND.value:
        pass_through = max(0.0, 1.0 - DEFEND_REDUCTION - p2_mod.defend_reduction)
        p1_damage = int(p1_damage * pass_through)

    p1_hp = max(0, player_one.hp - p2_damage - p1_self_damage)
    p2_hp = max(0, player_two.hp - p1_damage - p2_self_damage)
    p1_ability_used = player_one.ability_used or p1_used_ability_now
    p2_ability_used = player_two.ability_used or p2_used_ability_now

    status = "active"
    winner_user_id = None
    resolution = "continue"

    if p1_hp <= 0 and p2_hp <= 0:
        status = "draw"
        resolution = "double_ko"
    elif p1_hp <= 0:
        status = "finished"
        winner_user_id = player_two.user_id
        resolution = "knockout"
    elif p2_hp <= 0:
        status = "finished"
        winner_user_id = player_one.user_id
        resolution = "knockout"
    elif round_number >= MAX_ROUNDS:
        if p1_hp == p2_hp:
            status = "draw"
            resolution = "max_rounds_equal_hp"
        else:
            status = "finished"
            winner_user_id = player_one.user_id if p1_hp > p2_hp else player_two.user_id
            resolution = "max_rounds_hp"

    return RoundResolution(
        player_one_hp=p1_hp,
        player_two_hp=p2_hp,
        player_one_ability_used=p1_ability_used,
        player_two_ability_used=p2_ability_used,
        status=status,
        winner_user_id=winner_user_id,
        resolution=resolution,
        details={
            "player_one_action": p1_action,
            "player_two_action": p2_action,
            "player_one_damage_dealt": p1_damage,
            "player_two_damage_dealt": p2_damage,
            "player_one_self_damage": p1_self_damage,
            "player_two_self_damage": p2_self_damage,
            "player_one_ability_used_now": p1_used_ability_now,
            "player_two_ability_used_now": p2_used_ability_now,
        },
    )


def calculate_payout(stake_amount: int, status: str) -> Dict[str, int]:
    if stake_amount < 0:
        raise ValueError("Stake amount cannot be negative")
    pot = stake_amount * 2
    if status == "draw":
        return {"pot": pot, "winner_payout": 0, "burn_amount": 0, "refund_each": stake_amount}
    winner_payout = pot * WINNER_PAYOUT_BPS // 10000
    burn_amount = pot - winner_payout
    return {"pot": pot, "winner_payout": winner_payout, "burn_amount": burn_amount, "refund_each": 0}
