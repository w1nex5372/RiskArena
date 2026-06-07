"""
XP and level progression logic.

No FastAPI or DB imports — pure Python.
"""
from typing import TypedDict

XP_WIN = 50
XP_LOSS = 10
XP_DRAW = 25
XP_BOSS_HIT = 2          # XP per ~10-damage hit (total_damage // 5 in compute_rewards)
XP_BOSS_DEFEAT_BONUS = 30
XP_DAILY_LOGIN = 5

# XP floor for each level index (LEVEL_THRESHOLDS[n] = min XP to reach level n).
# Level 1 starts at 0; levels beyond the list use the linear extension.
_LEVEL_THRESHOLDS = [0, 0, 100, 250, 500, 1000]
_LINEAR_STEP = 750  # XP per level after the table ends


def xp_for_level(level: int) -> int:
    """Return minimum cumulative XP required to reach `level`."""
    if level <= 1:
        return 0
    if level < len(_LEVEL_THRESHOLDS):
        return _LEVEL_THRESHOLDS[level]
    return _LEVEL_THRESHOLDS[-1] + (level - (len(_LEVEL_THRESHOLDS) - 1)) * _LINEAR_STEP


def level_for_xp(xp: int) -> int:
    """Compute level from cumulative XP."""
    if xp < 0:
        return 1
    level = 1
    while level < 100 and xp_for_level(level + 1) <= xp:
        level += 1
    return level


def xp_to_next_level(xp: int) -> int:
    """XP remaining until the next level."""
    current = level_for_xp(xp)
    return max(0, xp_for_level(current + 1) - xp)


# Class slots: every player starts with 1 class; a 2nd unlocks at level 10 and a
# 3rd at level 15. The player chooses WHICH class fills each newly-earned slot.
CLASS_UNLOCK_LEVELS = (10, 15)


def class_slots_for_level(level: int) -> int:
    """How many class slots a player has earned at the given level (always >= 1)."""
    return 1 + sum(1 for threshold in CLASS_UNLOCK_LEVELS if level >= threshold)


class XpAwardResult(TypedDict):
    old_xp: int
    new_xp: int
    old_level: int
    new_level: int
    xp_gained: int
    leveled_up: bool


def award_xp_result(current_xp: int, amount: int) -> XpAwardResult:
    """Compute new XP and level after awarding `amount` XP."""
    old_level = level_for_xp(current_xp)
    new_xp = current_xp + max(0, amount)
    new_level = level_for_xp(new_xp)
    return XpAwardResult(
        old_xp=current_xp,
        new_xp=new_xp,
        old_level=old_level,
        new_level=new_level,
        xp_gained=amount,
        leveled_up=new_level > old_level,
    )
