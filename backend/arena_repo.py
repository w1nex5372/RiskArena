"""
PostgreSQL persistence for Arena Duel MVP.
"""
import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional

from database import get_pool
import progression as _prog
from arena_domain import (
    ArenaAction,
    ARMOR_HP_BONUS,
    ItemModifiers,
    MAX_ROUNDS,
    RARITY_MODIFIERS,
    STARTING_HP,
    PlayerCombatState,
    calculate_payout,
    normalize_action,
    resolve_round,
)

ROUND_TIMEOUT_SECONDS = 30


def _json(value) -> str:
    return json.dumps(value, default=str)


def _row(row) -> Optional[Dict]:
    if row is None:
        return None
    data = dict(row)
    for key in ("metadata", "resolution_details"):
        if isinstance(data.get(key), str):
            data[key] = json.loads(data[key])
    for key, value in list(data.items()):
        if isinstance(value, datetime):
            data[key] = value.isoformat()
    return data


def _modifiers_for_player(weapon_rarity: Optional[str], ability_rarity: Optional[str]) -> ItemModifiers:
    """Combine weapon and ability rarity into a single ItemModifiers for one player."""
    weapon_mod = RARITY_MODIFIERS.get(weapon_rarity or "", ItemModifiers())
    ability_mod = RARITY_MODIFIERS.get(ability_rarity or "", ItemModifiers())
    return ItemModifiers(
        attack_bonus=weapon_mod.attack_bonus,
        ability_bonus=ability_mod.ability_bonus,
        risk_win_chance=weapon_mod.risk_win_chance,
    )


async def _fetch_player_modifiers(conn, player_id: str) -> ItemModifiers:
    """Query equipped weapon and ability from inventory and return combined modifiers (legacy path)."""
    rows = await conn.fetch(
        """
        SELECT item_type, item_rarity FROM inventory
        WHERE user_id = $1 AND equipped = TRUE AND item_type IN ('weapon', 'ability')
        """,
        player_id,
    )
    weapon_rarity = next((r["item_rarity"] for r in rows if r["item_type"] == "weapon"), None)
    ability_rarity = next((r["item_rarity"] for r in rows if r["item_type"] == "ability"), None)
    return _modifiers_for_player(weapon_rarity, ability_rarity)


async def _get_player_modifiers_tx(conn, user_id: str) -> dict:
    """Sum all stat bonuses from equipped_items JOIN items for one player."""
    rows = await conn.fetch(
        """
        SELECT i.attack_bonus, i.ability_bonus, i.defend_reduction,
               i.hp_bonus, i.risk_win_chance
        FROM equipped_items ei
        JOIN items i ON i.id = ei.item_id
        WHERE ei.user_id = $1
        """,
        user_id,
    )
    total: dict = {
        "attack_bonus": 0,
        "ability_bonus": 0,
        "defend_reduction": 0.0,
        "hp_bonus": 0,
        "risk_win_chance": 0.0,
    }
    for row in rows:
        total["attack_bonus"]    += int(row["attack_bonus"] or 0)
        total["ability_bonus"]   += int(row["ability_bonus"] or 0)
        # DB defend_reduction is an integer percentage (e.g. 3 = 3% extra reduction).
        # ItemModifiers.defend_reduction is a float fraction subtracted from the
        # pass-through multiplier, so divide by 100.
        total["defend_reduction"] += float(row["defend_reduction"] or 0) / 100.0
        total["hp_bonus"]        += int(row["hp_bonus"] or 0)
        total["risk_win_chance"] += float(row["risk_win_chance"] or 0)
    return total


async def get_player_modifiers(user_id: str) -> dict:
    """Public helper — acquires its own connection from the pool."""
    async with get_pool().acquire() as conn:
        return await _get_player_modifiers_tx(conn, user_id)


async def create_duel(
    player_one_id: str,
    player_two_id: str,
    stake_amount: int,
    *,
    debit_stakes: bool = True,
    pot_amount: Optional[int] = None,
    metadata: Optional[Dict] = None,
    p1_hp: Optional[int] = None,
    p2_hp: Optional[int] = None,
) -> Dict:
    if player_one_id == player_two_id:
        raise ValueError("Duel requires two different players")
    if stake_amount <= 0:
        raise ValueError("Stake amount must be positive")

    match_id = str(uuid.uuid4())
    round_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    deadline = now + timedelta(seconds=ROUND_TIMEOUT_SECONDS)

    async with get_pool().acquire() as conn:
        async with conn.transaction():
            p1 = await conn.fetchrow("SELECT * FROM users WHERE id = $1 FOR UPDATE", player_one_id)
            p2 = await conn.fetchrow("SELECT * FROM users WHERE id = $1 FOR UPDATE", player_two_id)
            if not p1 or not p2:
                raise LookupError("User not found")
            if p1["is_banned"] or p2["is_banned"]:
                raise PermissionError("Banned users cannot start arena duels")
            if debit_stakes and (p1["token_balance"] < stake_amount or p2["token_balance"] < stake_amount):
                raise ArithmeticError("Insufficient token balance")
            active_conflict = await conn.fetchval(
                """
                SELECT 1
                FROM arena_matches
                WHERE status = 'active'
                  AND (
                    player_one_id = ANY($1::varchar[])
                    OR player_two_id = ANY($1::varchar[])
                  )
                LIMIT 1
                """,
                [player_one_id, player_two_id],
            )
            if active_conflict:
                raise RuntimeError("One of the players already has an active arena match")

            if debit_stakes:
                await conn.execute(
                    "UPDATE users SET token_balance = token_balance - $2 WHERE id = $1",
                    player_one_id,
                    stake_amount,
                )
                await conn.execute(
                    "UPDATE users SET token_balance = token_balance - $2 WHERE id = $1",
                    player_two_id,
                    stake_amount,
                )

            # Resolve starting HP.  If caller pre-computed modifiers (new item system),
            # they pass p1_hp / p2_hp directly.  Otherwise fall back to the legacy
            # inventory-based armor bonus so existing code paths keep working.
            if p1_hp is None or p2_hp is None:
                armor1 = await conn.fetchrow(
                    "SELECT item_rarity FROM inventory WHERE user_id = $1 AND equipped = TRUE AND item_type = 'armor' LIMIT 1",
                    player_one_id,
                )
                armor2 = await conn.fetchrow(
                    "SELECT item_rarity FROM inventory WHERE user_id = $1 AND equipped = TRUE AND item_type = 'armor' LIMIT 1",
                    player_two_id,
                )
                p1_hp = STARTING_HP + ARMOR_HP_BONUS.get(armor1["item_rarity"] if armor1 else "", 0)
                p2_hp = STARTING_HP + ARMOR_HP_BONUS.get(armor2["item_rarity"] if armor2 else "", 0)

            pot = pot_amount if pot_amount is not None else stake_amount * 2
            await conn.execute(
                """
                INSERT INTO arena_matches (
                    id, mode, status, player_one_id, player_two_id, stake_amount,
                    pot_amount, burn_amount, round_number, player_one_hp, player_two_hp,
                    player_one_ability_used, player_two_ability_used, metadata, created_at, updated_at
                )
                VALUES ($1, 'duel', 'active', $2, $3, $4, $5, 0, 1, $6, $7, FALSE, FALSE, $8, $9, $9)
                """,
                match_id,
                player_one_id,
                player_two_id,
                stake_amount,
                pot,
                p1_hp,
                p2_hp,
                _json(metadata or {}),
                now,
            )
            await conn.execute(
                """
                INSERT INTO arena_rounds (id, match_id, round_number, status, deadline_at, created_at)
                VALUES ($1, $2, 1, 'open', $3, $4)
                """,
                round_id,
                match_id,
                deadline,
                now,
            )
            return await get_match_tx(conn, match_id)


async def create_room_duel(
    player_one_id: str,
    player_two_id: str,
    stake_amount: int,
    room_id: str,
    room_type: str,
    pot_amount: Optional[int] = None,
) -> Dict:
    p1_mods = await get_player_modifiers(player_one_id)
    p2_mods = await get_player_modifiers(player_two_id)
    return await create_duel(
        player_one_id,
        player_two_id,
        stake_amount,
        debit_stakes=False,
        pot_amount=pot_amount if pot_amount is not None else stake_amount * 2,
        metadata={
            "source": "room",
            "room_id": room_id,
            "room_type": room_type,
            "p1_modifiers": p1_mods,
            "p2_modifiers": p2_mods,
        },
        p1_hp=STARTING_HP + p1_mods["hp_bonus"],
        p2_hp=STARTING_HP + p2_mods["hp_bonus"],
    )


async def get_match(match_id: str) -> Optional[Dict]:
    async with get_pool().acquire() as conn:
        return await get_match_tx(conn, match_id)


async def get_match_tx(conn, match_id: str) -> Optional[Dict]:
    match = await conn.fetchrow("SELECT * FROM arena_matches WHERE id = $1", match_id)
    if not match:
        return None
    rounds = await conn.fetch(
        "SELECT * FROM arena_rounds WHERE match_id = $1 ORDER BY round_number ASC",
        match_id,
    )
    actions = await conn.fetch(
        "SELECT * FROM arena_actions WHERE match_id = $1 ORDER BY submitted_at ASC",
        match_id,
    )
    data = _row(match)
    data["rounds"] = [_row(r) for r in rounds]
    data["actions"] = [_row(a) for a in actions]
    return data


async def submit_action(match_id: str, user_id: str, round_number: int, action: str) -> Dict:
    action = normalize_action(action)
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            match = await conn.fetchrow("SELECT * FROM arena_matches WHERE id = $1 FOR UPDATE", match_id)
            if not match:
                raise LookupError("Arena match not found")
            if match["status"] != "active":
                raise RuntimeError("Arena match is not active")
            if user_id not in (match["player_one_id"], match["player_two_id"]):
                raise PermissionError("User is not a participant in this arena match")
            if round_number != match["round_number"]:
                raise RuntimeError("Stale round submit")

            round_row = await conn.fetchrow(
                """
                SELECT * FROM arena_rounds
                WHERE match_id = $1 AND round_number = $2
                FOR UPDATE
                """,
                match_id,
                round_number,
            )
            if not round_row or round_row["status"] != "open":
                raise RuntimeError("Round is not open")
            if datetime.now(timezone.utc) > round_row["deadline_at"]:
                return await resolve_current_round_tx(conn, match_id, default_missing=True)

            try:
                await conn.execute(
                    """
                    INSERT INTO arena_actions (id, match_id, round_number, user_id, action, submitted_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    """,
                    str(uuid.uuid4()),
                    match_id,
                    round_number,
                    user_id,
                    action,
                    datetime.now(timezone.utc),
                )
            except Exception as exc:
                if "unique" in str(exc).lower():
                    raise RuntimeError("Action already submitted for this round") from exc
                raise

            submitted_count = await conn.fetchval(
                "SELECT COUNT(*) FROM arena_actions WHERE match_id = $1 AND round_number = $2",
                match_id,
                round_number,
            )
            if submitted_count >= 2:
                return await resolve_current_round_tx(conn, match_id, default_missing=False)
            return await get_match_tx(conn, match_id)


async def resolve_timeout(match_id: str, requester_user_id: Optional[str] = None) -> Dict:
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            match = await conn.fetchrow("SELECT * FROM arena_matches WHERE id = $1 FOR UPDATE", match_id)
            if not match:
                raise LookupError("Arena match not found")
            if requester_user_id and requester_user_id not in (match["player_one_id"], match["player_two_id"]):
                raise PermissionError("User is not a participant in this arena match")
            if match["status"] != "active":
                return await get_match_tx(conn, match_id)
            round_row = await conn.fetchrow(
                "SELECT * FROM arena_rounds WHERE match_id = $1 AND round_number = $2 FOR UPDATE",
                match_id,
                match["round_number"],
            )
            if datetime.now(timezone.utc) <= round_row["deadline_at"]:
                raise RuntimeError("Round deadline has not passed")
            return await resolve_current_round_tx(conn, match_id, default_missing=True)


async def resolve_current_round_tx(conn, match_id: str, default_missing: bool) -> Dict:
    match = await conn.fetchrow("SELECT * FROM arena_matches WHERE id = $1 FOR UPDATE", match_id)
    round_number = match["round_number"]
    actions = await conn.fetch(
        "SELECT * FROM arena_actions WHERE match_id = $1 AND round_number = $2",
        match_id,
        round_number,
    )
    by_user = {a["user_id"]: a["action"] for a in actions}
    if default_missing:
        for user_id in (match["player_one_id"], match["player_two_id"]):
            if user_id not in by_user:
                by_user[user_id] = ArenaAction.DEFEND.value
                await conn.execute(
                    """
                    INSERT INTO arena_actions (id, match_id, round_number, user_id, action, is_auto, submitted_at)
                    VALUES ($1, $2, $3, $4, $5, TRUE, $6)
                    ON CONFLICT (match_id, round_number, user_id) DO NOTHING
                    """,
                    str(uuid.uuid4()),
                    match_id,
                    round_number,
                    user_id,
                    ArenaAction.DEFEND.value,
                    datetime.now(timezone.utc),
                )
    if set(by_user.keys()) != {match["player_one_id"], match["player_two_id"]}:
        return await get_match_tx(conn, match_id)

    # Load modifiers from match metadata (locked in at match creation) so that
    # item swaps mid-fight have no effect.  Fall back to the legacy inventory
    # query for matches created before the new equipped_items system.
    raw_meta = match.get("metadata") or {}
    meta_dict = json.loads(raw_meta) if isinstance(raw_meta, str) else raw_meta
    p1_mods_stored = meta_dict.get("p1_modifiers")
    p2_mods_stored = meta_dict.get("p2_modifiers")
    if p1_mods_stored:
        p1_mod = ItemModifiers(**p1_mods_stored)
    else:
        p1_mod = await _fetch_player_modifiers(conn, match["player_one_id"])
    if p2_mods_stored:
        p2_mod = ItemModifiers(**p2_mods_stored)
    else:
        p2_mod = await _fetch_player_modifiers(conn, match["player_two_id"])

    result = resolve_round(
        PlayerCombatState(
            user_id=match["player_one_id"],
            hp=match["player_one_hp"],
            ability_used=match["player_one_ability_used"],
        ),
        PlayerCombatState(
            user_id=match["player_two_id"],
            hp=match["player_two_hp"],
            ability_used=match["player_two_ability_used"],
        ),
        by_user[match["player_one_id"]],
        by_user[match["player_two_id"]],
        round_number,
        player_one_modifiers=p1_mod,
        player_two_modifiers=p2_mod,
    )
    await conn.execute(
        """
        UPDATE arena_rounds
        SET status = 'resolved',
            player_one_action = $3,
            player_two_action = $4,
            player_one_hp_after = $5,
            player_two_hp_after = $6,
            resolution_details = $7,
            resolved_at = $8
        WHERE match_id = $1 AND round_number = $2
        """,
        match_id,
        round_number,
        by_user[match["player_one_id"]],
        by_user[match["player_two_id"]],
        result.player_one_hp,
        result.player_two_hp,
        _json(result.details),
        datetime.now(timezone.utc),
    )

    if result.status in ("finished", "draw"):
        await finish_match_tx(conn, match, result)
    else:
        next_round = round_number + 1
        now = datetime.now(timezone.utc)
        await conn.execute(
            """
            UPDATE arena_matches
            SET round_number = $2,
                player_one_hp = $3,
                player_two_hp = $4,
                player_one_ability_used = $5,
                player_two_ability_used = $6,
                updated_at = $7
            WHERE id = $1
            """,
            match_id,
            next_round,
            result.player_one_hp,
            result.player_two_hp,
            result.player_one_ability_used,
            result.player_two_ability_used,
            now,
        )
        await conn.execute(
            """
            INSERT INTO arena_rounds (id, match_id, round_number, status, deadline_at, created_at)
            VALUES ($1, $2, $3, 'open', $4, $5)
            """,
            str(uuid.uuid4()),
            match_id,
            next_round,
            now + timedelta(seconds=ROUND_TIMEOUT_SECONDS),
            now,
        )
    return await get_match_tx(conn, match_id)


async def finish_match_tx(conn, match, result) -> None:
    payout = calculate_payout(match["stake_amount"], result.status)
    now = datetime.now(timezone.utc)
    if result.status == "draw":
        await conn.execute(
            "UPDATE users SET token_balance = token_balance + $2 WHERE id = $1",
            match["player_one_id"],
            payout["refund_each"],
        )
        await conn.execute(
            "UPDATE users SET token_balance = token_balance + $2 WHERE id = $1",
            match["player_two_id"],
            payout["refund_each"],
        )
    else:
        await conn.execute(
            "UPDATE users SET token_balance = token_balance + $2 WHERE id = $1",
            result.winner_user_id,
            payout["winner_payout"],
        )

    # Award XP — keep per-player results to embed in match metadata
    p1_id = match["player_one_id"]
    p2_id = match["player_two_id"]
    xp_results: dict[str, dict] = {}
    if result.status == "draw":
        for uid in (p1_id, p2_id):
            xp_row = await conn.fetchrow("SELECT xp FROM users WHERE id = $1", uid)
            cur_xp = int(xp_row["xp"]) if xp_row else 0
            xp_res = _prog.award_xp_result(cur_xp, _prog.XP_DRAW)
            xp_results[str(uid)] = xp_res
            await conn.execute(
                "UPDATE users SET xp = $2, level = $3 WHERE id = $1",
                uid, xp_res["new_xp"], xp_res["new_level"],
            )
    else:
        loser_id = p2_id if result.winner_user_id == p1_id else p1_id
        for uid, amount in (
            (result.winner_user_id, _prog.XP_WIN),
            (loser_id, _prog.XP_LOSS),
        ):
            xp_row = await conn.fetchrow("SELECT xp FROM users WHERE id = $1", uid)
            cur_xp = int(xp_row["xp"]) if xp_row else 0
            xp_res = _prog.award_xp_result(cur_xp, amount)
            xp_results[str(uid)] = xp_res
            await conn.execute(
                "UPDATE users SET xp = $2, level = $3 WHERE id = $1",
                uid, xp_res["new_xp"], xp_res["new_level"],
            )

    await conn.execute(
        """
        UPDATE arena_matches
        SET status = $2,
            winner_user_id = $3,
            payout_amount = $4,
            burn_amount = $5,
            player_one_hp = $6,
            player_two_hp = $7,
            player_one_ability_used = $8,
            player_two_ability_used = $9,
            finished_at = $10,
            updated_at = $10,
            metadata = $11
        WHERE id = $1
        """,
        match["id"],
        result.status,
        result.winner_user_id,
        payout["winner_payout"],
        payout["burn_amount"],
        result.player_one_hp,
        result.player_two_hp,
        result.player_one_ability_used,
        result.player_two_ability_used,
        now,
        _json({"resolution": result.resolution, "payout": payout, "max_rounds": MAX_ROUNDS, "xp_results": xp_results}),
    )

    # Persist to completed_games for admin-created duels (no room context).
    # Room-based duels are saved by watch_arena_room_completion in server.py.
    try:
        raw_meta = match["metadata"]
        metadata = json.loads(raw_meta) if isinstance(raw_meta, str) else (raw_meta or {})
    except Exception:
        metadata = {}
    if metadata.get("source") != "room":
        winner_json = _json({"user_id": result.winner_user_id}) if result.winner_user_id else None
        players_json = _json([
            {"user_id": match["player_one_id"]},
            {"user_id": match["player_two_id"]},
        ])
        await conn.execute(
            """
            INSERT INTO completed_games
                (id, room_type, players, status, prize_pool, winner,
                 prize_link, match_id, round_number, created_at, started_at, finished_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO NOTHING
            """,
            match["id"],
            metadata.get("room_type", "duel"),
            players_json,
            result.status,
            match["pot_amount"],
            winner_json,
            None,
            match["id"],
            match["round_number"],
            match["created_at"],
            match["created_at"],
            now,
        )


async def resolve_expired_rounds(limit: int = 50) -> int:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT m.id
            FROM arena_matches m
            JOIN arena_rounds r
              ON r.match_id = m.id
             AND r.round_number = m.round_number
            WHERE m.status = 'active'
              AND r.status = 'open'
              AND r.deadline_at < NOW()
            ORDER BY r.deadline_at ASC
            LIMIT $1
            """,
            limit,
        )

    resolved = 0
    for row in rows:
        try:
            await resolve_timeout(row["id"], requester_user_id=None)
            resolved += 1
        except RuntimeError:
            continue
    return resolved
