"""
Boss Raid domain logic.

No FastAPI or DB imports — pure Python for testability.
"""
import random
from dataclasses import dataclass
from typing import Dict, List, Optional

from progression import XP_BOSS_HIT, XP_BOSS_DEFEAT_BONUS as XP_DEFEAT_BONUS

BASE_DAMAGE = 10
DAMAGE_VARIANCE = 2  # ±2

BOSS_NAMES = ["Shadow Drake", "Iron Golem", "Void Titan", "Storm Wyrm"]

TOP_DAMAGE_COINS_BONUS = 0.5  # +50% for the top damage dealer
RARE_DROP_THRESHOLD = 100
RARE_DROP_CHANCE = 0.10
COMMON_DROP_THRESHOLD = 50
COMMON_DROP_CHANCE = 0.05



def compute_attack_damage(rng: Optional[random.Random] = None) -> int:
    rng = rng or random.SystemRandom()
    return BASE_DAMAGE + rng.randint(-DAMAGE_VARIANCE, DAMAGE_VARIANCE)


def compute_phase(current_hp: int, max_hp: int) -> int:
    if max_hp <= 0:
        return 3
    ratio = current_hp / max_hp
    if ratio > 0.66:
        return 1
    if ratio > 0.33:
        return 2
    return 3


@dataclass
class ParticipantReward:
    user_id: str
    coins: int
    xp: int
    item_drop: Optional[str]


def compute_rewards(
    damage_by_user: Dict[str, int],
    defeated: bool = False,
    rng: Optional[random.Random] = None,
) -> List[ParticipantReward]:
    """
    Calculate end-of-raid rewards for all participants.
    damage_by_user: {user_id: total_damage_dealt}
    Top damage dealer receives a +50% coins bonus.
    If defeated=True, all participants gain XP_DEFEAT_BONUS extra XP.
    """
    rng = rng or random.SystemRandom()
    if not damage_by_user:
        return []

    top_user_id = max(damage_by_user, key=lambda u: damage_by_user[u])
    rewards: List[ParticipantReward] = []

    for user_id, total_damage in damage_by_user.items():
        coins = total_damage * 2
        xp = max(1, total_damage * XP_BOSS_HIT // 10) + (XP_DEFEAT_BONUS if defeated else 0)
        item_drop: Optional[str] = None

        if total_damage > RARE_DROP_THRESHOLD and rng.random() < RARE_DROP_CHANCE:
            item_drop = "Rare"
        elif total_damage > COMMON_DROP_THRESHOLD and rng.random() < COMMON_DROP_CHANCE:
            item_drop = "Common"

        if user_id == top_user_id:
            coins = int(coins * (1 + TOP_DAMAGE_COINS_BONUS))

        rewards.append(ParticipantReward(
            user_id=user_id,
            coins=coins,
            xp=xp,
            item_drop=item_drop,
        ))

    return rewards
