"""
PostgreSQL persistence for Boss Raid.
"""
import asyncio
import json
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

from database import get_pool
from boss_domain import compute_attack_damage, compute_phase, compute_rewards
import progression as _prog
import daily_quests as _daily_quests
from itemization import aggregate_item_modifiers, tier_to_rarity

RAID_DURATION_HOURS = 1


def _json(value) -> str:
    return json.dumps(value, default=str)


def _row(row) -> Optional[Dict]:
    if row is None:
        return None
    data = dict(row)
    for key in ("loot_table",):
        if isinstance(data.get(key), str):
            data[key] = json.loads(data[key])
    for key, value in list(data.items()):
        if isinstance(value, datetime):
            data[key] = value.isoformat()
    return data


async def _fetch_player_modifiers(conn, user_id: str):
    rows = await conn.fetch(
        """
        SELECT i.slot, i.attack_bonus, i.ability_bonus, i.defend_reduction,
               i.hp_bonus, i.risk_win_chance, i.passive_type, i.passive_value,
               COALESCE(inv.enchant_level, 0) AS enchant_level
        FROM equipped_items ei
        JOIN items i ON i.id = ei.item_id
        LEFT JOIN LATERAL (
            SELECT enchant_level
            FROM inventory
            WHERE user_id = ei.user_id
              AND item_id = ei.item_id
              AND (ei.inventory_id IS NULL OR id = ei.inventory_id)
            ORDER BY CASE WHEN id = ei.inventory_id THEN 0 ELSE 1 END, acquired_at ASC, id ASC
            LIMIT 1
        ) inv ON TRUE
        WHERE ei.user_id = $1
        """,
        user_id,
    )
    return aggregate_item_modifiers([dict(row) for row in rows])


async def _grant_boss_item_drop_tx(conn, user_id: str, tier: Optional[str], rng: random.Random) -> Optional[Dict]:
    if not tier:
        return None
    user_row = await conn.fetchrow("SELECT class_name FROM users WHERE id = $1", user_id)
    class_name = user_row["class_name"] if user_row else None
    if not class_name:
        return None
    items = await conn.fetch(
        """
        SELECT * FROM items
        WHERE class_name = $1 AND tier = $2
        ORDER BY slot ASC
        """,
        class_name,
        tier,
    )
    if not items:
        return None
    granted = dict(items[rng.randrange(len(items))])
    await conn.execute(
        """
        INSERT INTO inventory
            (id, user_id, item_type, item_name, item_rarity, equipped, item_id, source, acquired_at)
        VALUES ($1, $2, $3, $4, $5, FALSE, $6, 'boss', NOW())
        """,
        str(uuid.uuid4()),
        user_id,
        granted["slot"],
        granted["name"],
        tier_to_rarity(granted["tier"]),
        granted["id"],
    )
    return granted


async def get_active_raid() -> Optional[Dict]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM boss_raids WHERE status = 'active' ORDER BY created_at DESC LIMIT 1"
        )
        return _row(row)


async def get_raid(raid_id: str) -> Optional[Dict]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM boss_raids WHERE id = $1", raid_id)
        return _row(row)


async def _fetch_top_dealers(conn, raid_id: str, limit: int = 3) -> List[Dict]:
    rows = await conn.fetch(
        """
        SELECT d.user_id, u.first_name, SUM(d.damage) AS total_damage
        FROM boss_raid_damage d
        JOIN users u ON u.id = d.user_id
        WHERE d.raid_id = $1
        GROUP BY d.user_id, u.first_name
        ORDER BY total_damage DESC
        LIMIT $2
        """,
        raid_id,
        limit,
    )
    return [{"user_id": r["user_id"], "first_name": r["first_name"], "total_damage": int(r["total_damage"])} for r in rows]


async def _fetch_user_damage(conn, raid_id: str, user_id: str) -> int:
    val = await conn.fetchval(
        "SELECT COALESCE(SUM(damage), 0) FROM boss_raid_damage WHERE raid_id = $1 AND user_id = $2",
        raid_id,
        user_id,
    )
    return int(val or 0)


async def get_raid_state(raid_id: str, user_id: str) -> Optional[Dict]:
    """Full state including top_dealers and my_damage for API responses."""
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM boss_raids WHERE id = $1", raid_id)
        if not row:
            return None
        data = _row(row)
        data["top_dealers"] = await _fetch_top_dealers(conn, raid_id)
        data["my_damage"] = await _fetch_user_damage(conn, raid_id, user_id)
        return data


async def get_active_raid_state(user_id: str) -> Optional[Dict]:
    """get_raid_state for the currently active raid, or None."""
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM boss_raids WHERE status = 'active' ORDER BY created_at DESC LIMIT 1"
        )
        if not row:
            return None
        raid_id = row["id"]
        data = _row(row)
        data["top_dealers"] = await _fetch_top_dealers(conn, raid_id)
        data["my_damage"] = await _fetch_user_damage(conn, raid_id, user_id)
        return data


async def spawn_raid(name: str, level: int) -> Dict:
    raid_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    raid_end_at = now + timedelta(hours=RAID_DURATION_HOURS)
    max_hp = level * 500

    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO boss_raids
                (id, name, level, phase, max_hp, current_hp, status, raid_end_at, loot_table, rewards_settled, created_at)
            VALUES ($1, $2, $3, 1, $4, $4, 'active', $5, '{}', FALSE, $6)
            """,
            raid_id,
            name,
            level,
            max_hp,
            raid_end_at,
            now,
        )
        row = await conn.fetchrow("SELECT * FROM boss_raids WHERE id = $1", raid_id)
        return _row(row)


async def _settle_raid_tx(conn, raid_id: str) -> List[Dict]:
    """
    Aggregate damage, compute rewards, insert boss_raid_rewards, credit user balances.
    Guarded by rewards_settled flag — safe to call multiple times.
    Returns list of reward dicts for socket emission.
    """
    already = await conn.fetchval(
        "SELECT rewards_settled FROM boss_raids WHERE id = $1",
        raid_id,
    )
    if already:
        return []

    await conn.execute(
        "UPDATE boss_raids SET rewards_settled = TRUE WHERE id = $1",
        raid_id,
    )

    damage_rows = await conn.fetch(
        """
        SELECT user_id, SUM(damage) AS total_damage
        FROM boss_raid_damage
        WHERE raid_id = $1
        GROUP BY user_id
        """,
        raid_id,
    )
    damage_by_user = {r["user_id"]: int(r["total_damage"]) for r in damage_rows}

    status_row = await conn.fetchrow("SELECT status FROM boss_raids WHERE id = $1", raid_id)
    defeated = status_row["status"] == "defeated" if status_row else False

    rng = random.Random(f"{raid_id}:rewards")
    rewards = compute_rewards(damage_by_user, defeated=defeated, rng=rng)
    now = datetime.now(timezone.utc)
    reward_dicts: List[Dict] = []

    for r in rewards:
        granted_item = await _grant_boss_item_drop_tx(conn, r.user_id, r.item_drop_tier, rng)
        await conn.execute(
            """
            INSERT INTO boss_raid_rewards (raid_id, user_id, coins, xp, item_drop, claimed_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            raid_id,
            r.user_id,
            r.coins,
            r.xp,
            granted_item["name"] if granted_item else r.item_drop,
            now,
        )
        await conn.execute(
            "UPDATE users SET token_balance = token_balance + $2 WHERE id = $1",
            r.user_id,
            r.coins,
        )
        xp_row = await conn.fetchrow("SELECT xp FROM users WHERE id = $1", r.user_id)
        cur_xp = int(xp_row["xp"]) if xp_row else 0
        xp_res = _prog.award_xp_result(cur_xp, r.xp)
        await conn.execute(
            "UPDATE users SET xp = $2, level = $3 WHERE id = $1",
            r.user_id,
            xp_res["new_xp"],
            xp_res["new_level"],
        )
        reward_dicts.append({
            "user_id": r.user_id,
            "coins": r.coins,
            "xp": r.xp,
            "item_drop": granted_item["name"] if granted_item else r.item_drop,
            "item_drop_tier": r.item_drop_tier,
            "leveled_up": xp_res["leveled_up"],
            "new_level": xp_res["new_level"],
        })

    return reward_dicts


async def attack_boss(user_id: str) -> Tuple[Dict, Optional[List[Dict]]]:
    """
    Apply one attack to the current active boss.
    Returns (raid_state, rewards_if_just_settled).
    rewards_if_just_settled is None while the raid remains active.
    """
    rng = random.SystemRandom()

    async with get_pool().acquire() as conn:
        async with conn.transaction():
            # Identify the active raid inside the transaction
            active_row = await conn.fetchrow(
                "SELECT id FROM boss_raids WHERE status = 'active' ORDER BY created_at DESC LIMIT 1"
            )
            if not active_row:
                raise LookupError("No active boss raid")
            raid_id = active_row["id"]

            # Lock the row for this transaction
            row = await conn.fetchrow(
                "SELECT * FROM boss_raids WHERE id = $1 FOR UPDATE",
                raid_id,
            )

            # Re-check status after acquiring the lock (another worker may have just defeated it)
            if row["status"] != "active":
                raise RuntimeError("Boss raid is no longer active")

            now = datetime.now(timezone.utc)
            deadline = row["raid_end_at"]
            if isinstance(deadline, str):
                deadline = datetime.fromisoformat(deadline)

            # If the raid expired before this attack, close it out and settle
            if now > deadline:
                await conn.execute(
                    "UPDATE boss_raids SET status = 'expired' WHERE id = $1",
                    raid_id,
                )
                rewards = await _settle_raid_tx(conn, raid_id)
                updated = await conn.fetchrow("SELECT * FROM boss_raids WHERE id = $1", raid_id)
                state = _row(updated)
                state["top_dealers"] = await _fetch_top_dealers(conn, raid_id)
                state["my_damage"] = await _fetch_user_damage(conn, raid_id, user_id)
                return state, rewards

            modifiers = await _fetch_player_modifiers(conn, user_id)
            damage = compute_attack_damage(
                rng,
                flat_bonus=modifiers.attack_bonus,
                attack_percent_bonus=modifiers.bonus_attack_percent,
                boss_damage_percent=modifiers.boss_damage_percent,
            )
            new_hp = max(0, row["current_hp"] - damage)
            new_phase = compute_phase(new_hp, row["max_hp"])

            await conn.execute(
                """
                INSERT INTO boss_raid_damage (raid_id, user_id, damage, dealt_at)
                VALUES ($1, $2, $3, $4)
                """,
                raid_id,
                user_id,
                damage,
                now,
            )

            # Daily quest hooks for boss raid participation and damage
            await asyncio.gather(
                _daily_quests.increment_quest(user_id, "boss_raid"),
                _daily_quests.increment_quest(user_id, "deal_damage", amount=damage),
                return_exceptions=True,
            )

            rewards: Optional[List[Dict]] = None
            if new_hp <= 0:
                await conn.execute(
                    """
                    UPDATE boss_raids
                    SET current_hp = $2, phase = $3, status = 'defeated'
                    WHERE id = $1
                    """,
                    raid_id,
                    new_hp,
                    new_phase,
                )
                rewards = await _settle_raid_tx(conn, raid_id)
            else:
                await conn.execute(
                    """
                    UPDATE boss_raids
                    SET current_hp = $2, phase = $3
                    WHERE id = $1
                    """,
                    raid_id,
                    new_hp,
                    new_phase,
                )

            updated = await conn.fetchrow("SELECT * FROM boss_raids WHERE id = $1", raid_id)
            state = _row(updated)
            state["top_dealers"] = await _fetch_top_dealers(conn, raid_id)
            state["my_damage"] = await _fetch_user_damage(conn, raid_id, user_id)
            return state, rewards


async def settle_expired_raids() -> List[Dict]:
    """
    Find still-active raids whose deadline has passed and settle them.
    Returns list of settled raid summaries for the spawner to emit socket events.
    """
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name FROM boss_raids
            WHERE status = 'active' AND raid_end_at < NOW()
            ORDER BY raid_end_at ASC
            """
        )

    settled: List[Dict] = []
    for row in rows:
        raid_id = row["id"]
        try:
            async with get_pool().acquire() as conn:
                async with conn.transaction():
                    locked = await conn.fetchrow(
                        "SELECT * FROM boss_raids WHERE id = $1 FOR UPDATE",
                        raid_id,
                    )
                    if not locked or locked["status"] != "active":
                        continue
                    await conn.execute(
                        "UPDATE boss_raids SET status = 'expired' WHERE id = $1",
                        raid_id,
                    )
                    rewards = await _settle_raid_tx(conn, raid_id)
                    settled.append({
                        "raid_id": raid_id,
                        "name": locked["name"],
                        "status": "expired",
                        "rewards": rewards,
                    })
        except Exception as exc:
            import logging
            logging.error(f"[BossRaid] Failed to settle expired raid {raid_id}: {exc}")

    return settled
