"""
PostgreSQL persistence for Arena Duel MVP.
"""
import asyncio
import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional

from database import get_pool
import progression as _prog
import event_effects
import daily_quests as _daily_quests

_STREAK_MILESTONES = {3: 50, 5: 100, 7: 200}
from arena_domain import (
    ArenaAction,
    ItemModifiers,
    MAX_ROUNDS,
    STARTING_HP,
    PlayerCombatState,
    class_modifiers_for,
    combine_modifiers,
    normalize_action,
    resolve_round,
)
from itemization import aggregate_item_modifiers, modifiers_to_dict

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


def _item_modifiers_from_dict(modifiers: Optional[dict]) -> ItemModifiers:
    if not modifiers:
        return ItemModifiers()
    normalized = modifiers_to_dict(ItemModifiers())
    normalized.update(modifiers)
    return ItemModifiers(**normalized)


def _modifier_dict(modifiers: ItemModifiers) -> dict:
    return modifiers_to_dict(modifiers)


async def _fetch_player_class_names_tx(conn, player_one_id: str, player_two_id: str) -> tuple[Optional[str], Optional[str]]:
    rows = await conn.fetch(
        "SELECT id, class_name FROM users WHERE id = ANY($1::varchar[])",
        [player_one_id, player_two_id],
    )
    by_id = {row["id"]: row["class_name"] for row in rows}
    return by_id.get(player_one_id), by_id.get(player_two_id)


def _metadata_with_combat_state(
    metadata: Optional[Dict],
    *,
    player_one_class_name: Optional[str],
    player_two_class_name: Optional[str],
    player_one_modifiers: ItemModifiers,
    player_two_modifiers: ItemModifiers,
) -> Dict:
    data = dict(metadata or {})
    data["player_one_class_name"] = player_one_class_name
    data["player_two_class_name"] = player_two_class_name
    data["p1_modifiers"] = _modifier_dict(player_one_modifiers)
    data["p2_modifiers"] = _modifier_dict(player_two_modifiers)
    return data


async def _fetch_player_modifiers(conn, player_id: str) -> ItemModifiers:
    """Aggregate all equipped item stats and passives for one player."""
    rows = await conn.fetch(
        """
        SELECT i.slot, i.attack_bonus, i.ability_bonus, i.defend_reduction,
               i.hp_bonus, i.risk_win_chance, i.passive_type, i.passive_value,
               COALESCE(inv.enchant_level, 0) AS enchant_level
        FROM equipped_items ei
        JOIN items i ON i.id = ei.item_id
        JOIN users u ON u.id = ei.user_id AND (i.class_name = u.class_name OR i.class_name = 'any')
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
        player_id,
    )
    return aggregate_item_modifiers([dict(row) for row in rows])


async def _get_player_modifiers_tx(conn, user_id: str) -> dict:
    """Public JSON-friendly snapshot of aggregated equipped modifiers."""
    rows = await conn.fetch(
        """
        SELECT i.slot, i.attack_bonus, i.ability_bonus, i.defend_reduction,
               i.hp_bonus, i.risk_win_chance, i.passive_type, i.passive_value,
               COALESCE(inv.enchant_level, 0) AS enchant_level
        FROM equipped_items ei
        JOIN items i ON i.id = ei.item_id
        JOIN users u ON u.id = ei.user_id AND (i.class_name = u.class_name OR i.class_name = 'any')
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
    return modifiers_to_dict(aggregate_item_modifiers([dict(row) for row in rows]))


async def get_player_modifiers(user_id: str) -> dict:
    """Public helper — acquires its own connection from the pool."""
    async with get_pool().acquire() as conn:
        return await _get_player_modifiers_tx(conn, user_id)


async def _create_duel_tx(
    conn,
    player_one_id: str,
    player_two_id: str,
    stake_amount: int,
    *,
    debit_stakes: bool,
    pot_amount: Optional[int],
    metadata: Optional[Dict],
    p1_hp: Optional[int],
    p2_hp: Optional[int],
    player_rows: Optional[tuple] = None,
) -> Dict:
    match_id = str(uuid.uuid4())
    round_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    deadline = now + timedelta(seconds=ROUND_TIMEOUT_SECONDS)

    if player_rows is None:
        p1 = await conn.fetchrow("SELECT * FROM users WHERE id = $1 FOR UPDATE", player_one_id)
        p2 = await conn.fetchrow("SELECT * FROM users WHERE id = $1 FOR UPDATE", player_two_id)
    else:
        p1, p2 = player_rows
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

    metadata_dict = dict(metadata or {})
    p1_class_name = metadata_dict.get("player_one_class_name") or p1["class_name"]
    p2_class_name = metadata_dict.get("player_two_class_name") or p2["class_name"]

    p1_modifiers_stored = metadata_dict.get("p1_modifiers")
    p2_modifiers_stored = metadata_dict.get("p2_modifiers")
    if p1_modifiers_stored:
        p1_modifiers = _item_modifiers_from_dict(p1_modifiers_stored)
    else:
        p1_modifiers = combine_modifiers(
            await _fetch_player_modifiers(conn, player_one_id),
            class_modifiers_for(p1_class_name),
        )
    if p2_modifiers_stored:
        p2_modifiers = _item_modifiers_from_dict(p2_modifiers_stored)
    else:
        p2_modifiers = combine_modifiers(
            await _fetch_player_modifiers(conn, player_two_id),
            class_modifiers_for(p2_class_name),
        )

    # Resolve starting HP from the frozen combined modifiers unless the caller
    # already provided explicit values.
    if p1_hp is None or p2_hp is None:
        p1_hp = STARTING_HP + p1_modifiers.hp_bonus
        p2_hp = STARTING_HP + p2_modifiers.hp_bonus

    metadata_dict = _metadata_with_combat_state(
        metadata_dict,
        player_one_class_name=p1_class_name,
        player_two_class_name=p2_class_name,
        player_one_modifiers=p1_modifiers,
        player_two_modifiers=p2_modifiers,
    )

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
        _json(metadata_dict),
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

    async with get_pool().acquire() as conn:
        async with conn.transaction():
            return await _create_duel_tx(
                conn,
                player_one_id,
                player_two_id,
                stake_amount,
                debit_stakes=debit_stakes,
                pot_amount=pot_amount,
                metadata=metadata,
                p1_hp=p1_hp,
                p2_hp=p2_hp,
            )


async def create_room_duel(
    player_one_id: str,
    player_two_id: str,
    stake_amount: int,
    room_id: str,
    room_type: str,
    pot_amount: Optional[int] = None,
) -> Dict:
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            p1 = await conn.fetchrow("SELECT * FROM users WHERE id = $1 FOR UPDATE", player_one_id)
            p2 = await conn.fetchrow("SELECT * FROM users WHERE id = $1 FOR UPDATE", player_two_id)
            p1_mods = await _get_player_modifiers_tx(conn, player_one_id)
            p2_mods = await _get_player_modifiers_tx(conn, player_two_id)
            p1_class_name = p1["class_name"] if p1 else None
            p2_class_name = p2["class_name"] if p2 else None
            p1_combined = combine_modifiers(_item_modifiers_from_dict(p1_mods), class_modifiers_for(p1_class_name))
            p2_combined = combine_modifiers(_item_modifiers_from_dict(p2_mods), class_modifiers_for(p2_class_name))
            return await _create_duel_tx(
                conn,
                player_one_id,
                player_two_id,
                stake_amount,
                debit_stakes=False,
                pot_amount=pot_amount if pot_amount is not None else stake_amount * 2,
                metadata=_metadata_with_combat_state(
                    {
                        "source": "room",
                        "room_id": room_id,
                        "room_type": room_type,
                    },
                    player_one_class_name=p1_class_name,
                    player_two_class_name=p2_class_name,
                    player_one_modifiers=p1_combined,
                    player_two_modifiers=p2_combined,
                ),
                p1_hp=STARTING_HP + p1_combined.hp_bonus,
                p2_hp=STARTING_HP + p2_combined.hp_bonus,
                player_rows=(p1, p2),
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
    metadata = data.get("metadata") or {}
    if isinstance(metadata, dict):
        if "player_one_class_name" not in data:
            data["player_one_class_name"] = metadata.get("player_one_class_name")
        if "player_two_class_name" not in data:
            data["player_two_class_name"] = metadata.get("player_two_class_name")
    if match["status"] != "active" and (not data.get("player_one_class_name") or not data.get("player_two_class_name")):
        p1_class_name, p2_class_name = await _fetch_player_class_names_tx(
            conn,
            data["player_one_id"],
            data["player_two_id"],
        )
        data["player_one_class_name"] = data.get("player_one_class_name") or p1_class_name
        data["player_two_class_name"] = data.get("player_two_class_name") or p2_class_name
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
        p1_mod = _item_modifiers_from_dict(p1_mods_stored)
    else:
        p1_mod = combine_modifiers(
            await _fetch_player_modifiers(conn, match["player_one_id"]),
            class_modifiers_for(meta_dict.get("player_one_class_name")),
        )
    if p2_mods_stored:
        p2_mod = _item_modifiers_from_dict(p2_mods_stored)
    else:
        p2_mod = combine_modifiers(
            await _fetch_player_modifiers(conn, match["player_two_id"]),
            class_modifiers_for(meta_dict.get("player_two_class_name")),
        )

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
    now = datetime.now(timezone.utc)
    xp_multiplier = await event_effects.multiplier(conn, "xp_multiplier")
    coin_multiplier = await event_effects.multiplier(conn, "coin_multiplier")
    try:
        raw_meta = match["metadata"]
        metadata = json.loads(raw_meta) if isinstance(raw_meta, str) else (raw_meta or {})
    except Exception:
        metadata = {}

    # Award XP — keep per-player results to embed in match metadata
    p1_id = match["player_one_id"]
    p2_id = match["player_two_id"]
    xp_results: dict[str, dict] = {}
    if result.status == "draw":
        for uid in (p1_id, p2_id):
            xp_row = await conn.fetchrow("SELECT xp FROM users WHERE id = $1", uid)
            cur_xp = int(xp_row["xp"]) if xp_row else 0
            xp_res = _prog.award_xp_result(cur_xp, round(_prog.XP_DRAW * xp_multiplier))
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
            xp_res = _prog.award_xp_result(cur_xp, round(amount * xp_multiplier))
            xp_results[str(uid)] = xp_res
            await conn.execute(
                "UPDATE users SET xp = $2, level = $3 WHERE id = $1",
                uid, xp_res["new_xp"], xp_res["new_level"],
            )

    # Win streak tracking
    streak_results: dict[str, dict] = {}
    if result.status == "draw":
        for uid in (p1_id, p2_id):
            await conn.execute("UPDATE users SET current_win_streak = 0 WHERE id = $1", uid)
            streak_results[str(uid)] = {"streak": 0, "bonus": 0, "is_record": False}
    else:
        winner_row = await conn.fetchrow(
            """
            UPDATE users
            SET current_win_streak = current_win_streak + 1,
                max_win_streak     = GREATEST(max_win_streak, current_win_streak + 1)
            WHERE id = $1
            RETURNING current_win_streak, max_win_streak
            """,
            result.winner_user_id,
        )
        new_streak = winner_row["current_win_streak"]
        streak_bonus = round(_STREAK_MILESTONES.get(new_streak, 0) * coin_multiplier)
        if streak_bonus > 0:
            await conn.execute(
                "UPDATE users SET token_balance = token_balance + $2 WHERE id = $1",
                result.winner_user_id, streak_bonus,
            )
        streak_results[str(result.winner_user_id)] = {
            "streak": new_streak,
            "bonus": streak_bonus,
            "is_record": new_streak > 1 and new_streak == winner_row["max_win_streak"],
        }
        await conn.execute("UPDATE users SET current_win_streak = 0 WHERE id = $1", loser_id)
        streak_results[str(loser_id)] = {"streak": 0, "bonus": 0, "is_record": False}

    final_metadata = dict(metadata or {})
    final_metadata.update({
        "resolution": result.resolution,
        "max_rounds": MAX_ROUNDS,
        "xp_results": xp_results,
        "streak_results": streak_results,
    })

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
        0,
        0,
        result.player_one_hp,
        result.player_two_hp,
        result.player_one_ability_used,
        result.player_two_ability_used,
        now,
        _json(final_metadata),
    )

    # Persist to completed_games for admin-created duels (no room context).
    # Room-based duels are saved by watch_arena_room_completion in server.py.
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

    # Daily quest hooks — both players played a match
    quest_tasks = [
        _daily_quests.increment_quest(p1_id, "play_match"),
        _daily_quests.increment_quest(p2_id, "play_match"),
    ]
    if result.status != "draw" and result.winner_user_id:
        quest_tasks.append(_daily_quests.increment_quest(result.winner_user_id, "win_arena"))
    await asyncio.gather(*quest_tasks, return_exceptions=True)


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
