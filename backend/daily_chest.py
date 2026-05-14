"""
Free daily chest reward helpers and transactional claim logic.
"""
from datetime import datetime, time, timedelta, timezone
import random
import uuid
from typing import Any, Dict, Optional

from itemization import tier_to_rarity

ITEM_DROP_CHANCES = (
    ("common", 0.35),
    ("uncommon", 0.15),
    ("rare", 0.05),
    ("epic", 0.02),
    ("legendary", 0.003),
)
COIN_MIN = 20
COIN_MAX = 80
XP_MIN = 5
XP_MAX = 20


def _utc_datetime(now: Optional[datetime] = None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def current_chest_date(now: Optional[datetime] = None):
    """Daily chest resets on UTC calendar days."""
    return _utc_datetime(now).date()


def next_chest_reset_at(now: Optional[datetime] = None) -> datetime:
    chest_date = current_chest_date(now)
    return datetime.combine(chest_date + timedelta(days=1), time.min, tzinfo=timezone.utc)


def chest_timing(now: Optional[datetime] = None) -> Dict[str, str]:
    now_utc = _utc_datetime(now)
    reset_at = next_chest_reset_at(now_utc)
    return {
        "chest_date": current_chest_date(now_utc).isoformat(),
        "reset_at": reset_at.isoformat().replace("+00:00", "Z"),
        "next_available_at": reset_at.isoformat().replace("+00:00", "Z"),
    }


def roll_item_tier(roll: float) -> Optional[str]:
    cursor = 0.0
    for tier, chance in ITEM_DROP_CHANCES:
        cursor += chance
        if roll < round(cursor, 10):
            return tier
    return None


def roll_daily_chest_reward(rng: Optional[Any] = None) -> Dict[str, Any]:
    rng = rng or random.SystemRandom()
    return {
        "coins": int(rng.randint(COIN_MIN, COIN_MAX)),
        "xp": int(rng.randint(XP_MIN, XP_MAX)),
        "item_tier": roll_item_tier(float(rng.random())),
    }


def _serialize_item_drop(item: Optional[Any], inventory_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not item or not inventory_id:
        return None
    return {
        "inventory_id": inventory_id,
        "item_id": int(item["id"]),
        "name": item["name"],
        "class_name": item["class_name"],
        "slot": item["slot"],
        "tier": item["tier"],
        "rarity": tier_to_rarity(item["tier"]),
        "enchant_level": 0,
    }


async def get_daily_chest_state(conn, user_id: str, now: Optional[datetime] = None) -> Dict[str, Any]:
    chest_date = current_chest_date(now)
    timing = chest_timing(now)
    row = await conn.fetchrow(
        """
        SELECT claimed_at, reward_coins, reward_xp, item_tier, item_id, inventory_id
        FROM daily_chest_claims
        WHERE user_id = $1 AND claim_date = $2::date
        """,
        user_id,
        chest_date,
    )
    claimed_today = bool(row)
    last_reward = None
    if row:
        last_reward = {
            "reward_coins": int(row["reward_coins"] or 0),
            "reward_xp": int(row["reward_xp"] or 0),
            "item_tier": row["item_tier"],
            "item_id": int(row["item_id"]) if row["item_id"] is not None else None,
            "inventory_id": row["inventory_id"],
            "claimed_at": row["claimed_at"].isoformat().replace("+00:00", "Z") if row["claimed_at"] else None,
        }
    return {
        "available": not claimed_today,
        "claimed_today": claimed_today,
        **timing,
        "last_reward": last_reward,
    }


async def _choose_drop_item(conn, tier: str, class_name: Optional[str]):
    if class_name:
        return await conn.fetchrow(
            """
            SELECT *
            FROM items
            WHERE tier = $1 AND class_name = $2
            ORDER BY RANDOM()
            LIMIT 1
            """,
            tier,
            class_name,
        )
    return await conn.fetchrow(
        """
        SELECT *
        FROM items
        WHERE tier = $1
        ORDER BY RANDOM()
        LIMIT 1
        """,
        tier,
    )


async def claim_daily_chest_in_transaction(
    conn,
    user_id: str,
    rng: Optional[Any] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    chest_date = current_chest_date(now)
    claim_row = await conn.fetchrow(
        """
        INSERT INTO daily_chest_claims (user_id, claim_date, claimed_at)
        VALUES ($1, $2::date, NOW())
        ON CONFLICT (user_id, claim_date) DO NOTHING
        RETURNING user_id, claim_date
        """,
        user_id,
        chest_date,
    )
    if not claim_row:
        raise ValueError("Daily chest already claimed")

    reward = roll_daily_chest_reward(rng)
    user_row = await conn.fetchrow(
        """
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
        RETURNING token_balance, xp, level, class_name
        """,
        user_id,
        reward["coins"],
        reward["xp"],
    )
    if not user_row:
        raise ValueError("User not found")

    item = None
    inventory_id = None
    if reward["item_tier"]:
        item = await _choose_drop_item(conn, reward["item_tier"], user_row["class_name"])
        if item:
            inventory_id = str(uuid.uuid4())
            await conn.execute(
                """
                INSERT INTO inventory
                    (id, user_id, item_type, item_name, item_rarity, equipped, item_id, source, enchant_level, acquired_at)
                VALUES ($1, $2, $3, $4, $5, FALSE, $6, 'daily_chest', 0, NOW())
                """,
                inventory_id,
                user_id,
                item["slot"],
                item["name"],
                tier_to_rarity(item["tier"]),
                item["id"],
            )

    await conn.execute(
        """
        UPDATE daily_chest_claims
        SET reward_coins = $3,
            reward_xp = $4,
            item_tier = $5,
            item_id = $6,
            inventory_id = $7
        WHERE user_id = $1 AND claim_date = $2::date
        """,
        user_id,
        chest_date,
        reward["coins"],
        reward["xp"],
        reward["item_tier"],
        item["id"] if item else None,
        inventory_id,
    )

    timing = chest_timing(now)
    item_drop = _serialize_item_drop(item, inventory_id)
    return {
        "success": True,
        "reward_coins": reward["coins"],
        "reward_xp": reward["xp"],
        "item_drop": item_drop,
        "inventory_id": inventory_id,
        "new_balance": int(user_row["token_balance"]),
        "new_xp": int(user_row["xp"]),
        "new_level": int(user_row["level"]),
        "reset_at": timing["reset_at"],
        "next_available_at": timing["next_available_at"],
    }
