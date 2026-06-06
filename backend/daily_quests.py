"""
Daily quest definitions and progress helpers.
No FastAPI imports - called from server.py and repos.
"""
from datetime import datetime, time, timedelta, timezone
from typing import Dict, List, Optional

from database import get_pool
from event_effects import boosted_amount

QUESTS: List[Dict] = [
    {
        "key": "login",
        "label": "Daily Login",
        "description": "Log in today",
        "icon": "login",
        "goal": 1,
        "reward_coins": 5,
        "reward_xp": 0,
    },
    {
        "key": "play_match",
        "label": "Battle Ready",
        "description": "Play 3 arena matches",
        "icon": "battle",
        "goal": 3,
        "reward_coins": 30,
        "reward_xp": 10,
    },
    {
        "key": "win_arena",
        "label": "Arena Victor",
        "description": "Win 2 arena matches",
        "icon": "victory",
        "goal": 2,
        "reward_coins": 50,
        "reward_xp": 0,
    },
    {
        "key": "boss_raid",
        "label": "Raid Warrior",
        "description": "Attack the Boss Raid",
        "icon": "raid",
        "goal": 1,
        "reward_coins": 20,
        "reward_xp": 0,
    },
    {
        "key": "deal_damage",
        "label": "Damage Dealer",
        "description": "Deal 500 damage in Boss Raid",
        "icon": "damage",
        "goal": 500,
        "reward_coins": 0,
        "reward_xp": 30,
    },
]

QUEST_MAP: Dict[str, Dict] = {q["key"]: q for q in QUESTS}


def _utc_datetime(now: Optional[datetime] = None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def current_quest_date(now: Optional[datetime] = None):
    """Daily quests reset on UTC calendar days."""
    return _utc_datetime(now).date()


def next_quest_reset_at(now: Optional[datetime] = None) -> datetime:
    quest_date = current_quest_date(now)
    return datetime.combine(quest_date + timedelta(days=1), time.min, tzinfo=timezone.utc)


def quest_timing(now: Optional[datetime] = None) -> Dict[str, str]:
    now_utc = _utc_datetime(now)
    quest_date = current_quest_date(now_utc)
    return {
        "quest_date": quest_date.isoformat(),
        "reset_at": next_quest_reset_at(now_utc).isoformat().replace("+00:00", "Z"),
    }


async def increment_quest(user_id: str, quest_key: str, amount: int = 1) -> None:
    """
    Upsert progress for a quest. Marks completed=TRUE when progress >= goal.
    Safe to call multiple times (idempotent once completed).
    """
    quest = QUEST_MAP.get(quest_key)
    if not quest:
        return
    today = current_quest_date()
    goal = quest["goal"]
    async with get_pool().acquire() as conn:
        await conn.execute("""
            INSERT INTO daily_quest_progress (user_id, quest_date, quest_key, progress, completed, claimed)
            VALUES ($1, $2::date, $3, LEAST($4, $5), ($4 >= $5), FALSE)
            ON CONFLICT (user_id, quest_date, quest_key) DO UPDATE
            SET progress  = LEAST(daily_quest_progress.progress + $4, $5),
                completed = (daily_quest_progress.progress + $4 >= $5)
            WHERE NOT daily_quest_progress.completed
        """, user_id, today, quest_key, amount, goal)


async def get_quests_for_user(user_id: str) -> List[Dict]:
    """
    Return today's quest list with current progress merged in.
    Auto-completes the login quest (progress=1) on first call each day.
    """
    today = current_quest_date()
    async with get_pool().acquire() as conn:
        await conn.execute("""
            INSERT INTO daily_quest_progress (user_id, quest_date, quest_key, progress, completed, claimed)
            VALUES ($1, $2::date, 'login', 1, TRUE, FALSE)
            ON CONFLICT (user_id, quest_date, quest_key) DO NOTHING
        """, user_id, today)
        rows = await conn.fetch("""
            SELECT quest_key, progress, completed, claimed
            FROM daily_quest_progress
            WHERE user_id = $1 AND quest_date = $2::date
        """, user_id, today)
    progress_map = {r["quest_key"]: dict(r) for r in rows}
    result = []
    for q in QUESTS:
        p = progress_map.get(q["key"], {})
        result.append({
            **q,
            "progress": p.get("progress", 0),
            "completed": p.get("completed", False),
            "claimed": p.get("claimed", False),
        })
    return result


async def _raise_claim_error(conn, user_id: str, quest_key: str, quest_date) -> None:
    row = await conn.fetchrow("""
        SELECT completed, claimed FROM daily_quest_progress
        WHERE user_id = $1 AND quest_date = $2::date AND quest_key = $3
    """, user_id, quest_date, quest_key)
    if not row:
        raise ValueError("Quest not started")
    if not row["completed"]:
        raise ValueError("Quest not completed yet")
    if row["claimed"]:
        raise ValueError("Already claimed")
    raise ValueError("Quest cannot be claimed")


async def _award_daily_quest_reward(conn, user_id: str, coins: int, xp: int):
    xp_gain = max(0, int(xp))
    return await conn.fetchrow("""
        UPDATE users
        SET token_balance = COALESCE(token_balance, 0) + $2,
            xp = COALESCE(xp, 0) + $3,
            level = CASE
                WHEN COALESCE(xp, 0) + $3 < 100 THEN 1
                WHEN COALESCE(xp, 0) + $3 < 250 THEN 2
                WHEN COALESCE(xp, 0) + $3 < 500 THEN 3
                WHEN COALESCE(xp, 0) + $3 < 1000 THEN 4
                ELSE LEAST(100, 5 + FLOOR((COALESCE(xp, 0) + $3 - 1000)::numeric / 750)::int)
            END
        WHERE id = $1
        RETURNING token_balance, xp, level
    """, user_id, int(coins), xp_gain)


async def claim_quest_in_transaction(conn, user_id: str, quest_key: str) -> Dict:
    """Mark a completed quest as claimed and award rewards in one transaction."""
    quest = QUEST_MAP.get(quest_key)
    if not quest:
        raise ValueError("Unknown quest")

    today = current_quest_date()
    claim_row = await conn.fetchrow("""
        UPDATE daily_quest_progress
        SET claimed = TRUE
        WHERE user_id = $1
          AND quest_date = $2::date
          AND quest_key = $3
          AND completed = TRUE
          AND claimed = FALSE
        RETURNING quest_key
    """, user_id, today, quest_key)
    if not claim_row:
        await _raise_claim_error(conn, user_id, quest_key, today)

    coins = await boosted_amount(conn, int(quest["reward_coins"]), "coin_multiplier")
    xp = await boosted_amount(conn, int(quest["reward_xp"]), "xp_multiplier")
    updated_user = await _award_daily_quest_reward(conn, user_id, coins, xp)
    if not updated_user:
        raise ValueError("User not found")

    return {
        "success": True,
        "reward_coins": coins,
        "reward_xp": xp,
        "new_balance": int(updated_user["token_balance"]),
        "new_xp": int(updated_user["xp"]),
        "new_level": int(updated_user["level"]),
    }
