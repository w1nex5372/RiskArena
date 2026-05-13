"""
db_queries.py — All PostgreSQL database operations (replaces MongoDB/Motor calls)
Each function corresponds to one or more MongoDB operations from the original server.py.
"""
import json
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone

from database import get_pool


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _parse_dt(value) -> Optional[datetime]:
    """Convert ISO string or datetime to datetime object (returns None on failure)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return None


def _to_dt(val) -> Optional[datetime]:
    """Convert ISO string or datetime to datetime object for asyncpg (fallback to now)."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    try:
        return datetime.fromisoformat(str(val))
    except Exception:
        return datetime.now(timezone.utc)


def _to_json(val) -> Optional[str]:
    """Convert dict/list to JSON string, safely handling datetime serialization."""
    if val is None:
        return None
    if isinstance(val, str):
        return val
    return json.dumps(val, default=str)


def _row_to_dict(row) -> Optional[Dict]:
    """Convert asyncpg Record to dict."""
    if row is None:
        return None
    d = dict(row)
    # Convert JSONB/JSON-string fields back to Python objects
    for key in ('players', 'winner', 'all_players', 'private_key'):
        if key in d and isinstance(d[key], str):
            try:
                d[key] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                pass
    # Convert datetime to ISO string for Pydantic compatibility
    for key in ('created_at', 'last_login', 'started_at', 'finished_at',
                'won_at', 'purchase_date', 'detected_at', 'last_daily_claim'):
        if key in d and d[key] is not None and isinstance(d[key], datetime):
            d[key] = d[key].isoformat()
    return d


def _rows_to_list(rows) -> List[Dict]:
    return [_row_to_dict(r) for r in rows]


# ─────────────────────────────────────────────────────────────────
# USERS
# ─────────────────────────────────────────────────────────────────

async def get_user_by_telegram_id(telegram_id: int) -> Optional[Dict]:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM users WHERE telegram_id = $1", telegram_id
        )
        return _row_to_dict(row)


async def get_user_by_id(user_id: str) -> Optional[Dict]:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM users WHERE id = $1", user_id
        )
        return _row_to_dict(row)


async def get_user_by_username(username: str) -> Optional[Dict]:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM users WHERE telegram_username = $1", username
        )
        return _row_to_dict(row)


async def insert_user(user_dict: Dict) -> bool:
    pool = get_pool()
    async with pool.acquire() as conn:
        try:
            await conn.execute("""
                INSERT INTO users (
                    id, telegram_id, first_name, last_name, telegram_username,
                    photo_url, wallet_address, personal_solana_address,
                    derived_solana_address, derivation_path,
                    token_balance, is_verified, is_admin, is_owner, role,
                    last_daily_claim, created_at, last_login
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
                )
            """,
                user_dict.get('id'),
                user_dict.get('telegram_id'),
                user_dict.get('first_name', ''),
                user_dict.get('last_name'),
                user_dict.get('telegram_username'),
                user_dict.get('photo_url'),
                user_dict.get('wallet_address'),
                user_dict.get('personal_solana_address'),
                user_dict.get('derived_solana_address'),
                user_dict.get('derivation_path'),
                user_dict.get('token_balance', 0),
                user_dict.get('is_verified', False),
                user_dict.get('is_admin', False),
                user_dict.get('is_owner', False),
                user_dict.get('role', 'user'),
                _parse_dt(user_dict.get('last_daily_claim')),
                _parse_dt(user_dict.get('created_at')) or datetime.now(timezone.utc),
                _parse_dt(user_dict.get('last_login')) or datetime.now(timezone.utc),
            )
            return True
        except Exception as e:
            logging.error(f"insert_user error: {e}")
            return False


async def update_user_fields(user_id: str, fields: Dict) -> bool:
    """Update user by internal id (UUID string)."""
    if not fields:
        return False
    pool = get_pool()
    dt_fields = {'last_daily_claim', 'last_login', 'created_at'}
    allowed = {
        'first_name', 'last_name', 'telegram_username', 'photo_url',
        'wallet_address', 'personal_solana_address', 'derived_solana_address',
        'derivation_path', 'token_balance', 'is_verified',
        'role', 'last_daily_claim', 'last_login', 'is_banned',
        # is_admin / is_owner intentionally excluded — use set_user_role() instead
    }
    filtered = {k: (_parse_dt(v) if k in dt_fields else v)
                for k, v in fields.items() if k in allowed}
    if not filtered:
        return False
    async with get_pool().acquire() as conn:
        sets = ', '.join(f"{k} = ${i+2}" for i, k in enumerate(filtered))
        await conn.execute(
            f"UPDATE users SET {sets} WHERE id = $1",
            user_id, *filtered.values()
        )
        return True


async def update_user_fields_by_telegram_id(telegram_id: int, fields: Dict) -> bool:
    """Update user by telegram_id."""
    if not fields:
        return False
    dt_fields = {'last_daily_claim', 'last_login', 'created_at'}
    allowed = {
        'first_name', 'last_name', 'telegram_username', 'photo_url',
        'wallet_address', 'personal_solana_address', 'derived_solana_address',
        'derivation_path', 'token_balance', 'is_verified', 'is_admin',
        'is_owner', 'role', 'last_daily_claim', 'last_login', 'is_banned',
    }
    filtered = {k: (_parse_dt(v) if k in dt_fields else v)
                for k, v in fields.items() if k in allowed}
    if not filtered:
        return False
    async with get_pool().acquire() as conn:
        sets = ', '.join(f"{k} = ${i+2}" for i, k in enumerate(filtered))
        await conn.execute(
            f"UPDATE users SET {sets} WHERE telegram_id = $1",
            telegram_id, *filtered.values()
        )
        return True


async def increment_user_tokens(user_id: str, amount: int) -> Optional[Dict]:
    """Atomically increment token_balance and return updated user. Replaces $inc + find_one.
    When amount is negative, guards against going below zero."""
    async with get_pool().acquire() as conn:
        if amount < 0:
            row = await conn.fetchrow(
                "UPDATE users SET token_balance = token_balance + $2 "
                "WHERE id = $1 AND token_balance + $2 >= 0 RETURNING *",
                user_id, amount
            )
        else:
            row = await conn.fetchrow(
                "UPDATE users SET token_balance = token_balance + $2 WHERE id = $1 RETURNING *",
                user_id, amount
            )
        return _row_to_dict(row)


async def increment_user_tokens_by_telegram_id(telegram_id: int, amount: int) -> Optional[Dict]:
    async with get_pool().acquire() as conn:
        if amount < 0:
            row = await conn.fetchrow(
                "UPDATE users SET token_balance = token_balance + $2 "
                "WHERE telegram_id = $1 AND token_balance + $2 >= 0 RETURNING *",
                telegram_id, amount
            )
        else:
            row = await conn.fetchrow(
                "UPDATE users SET token_balance = token_balance + $2 WHERE telegram_id = $1 RETURNING *",
                telegram_id, amount
            )
        return _row_to_dict(row)


async def get_leaderboard(tab: str = "coins", limit: int = 20) -> List[Dict]:
    base_select = """
        SELECT u.id, u.first_name, u.telegram_username, u.photo_url,
               u.token_balance, u.level, u.xp, u.class_name,
               COUNT(am.id) FILTER (WHERE am.winner_user_id = u.id) AS wins
        FROM users u
        LEFT JOIN arena_matches am ON am.status = 'finished'
             AND (am.player_one_id = u.id OR am.player_two_id = u.id)
        GROUP BY u.id
    """
    if tab == "wins":
        order = "ORDER BY wins DESC, u.token_balance DESC"
    elif tab == "level":
        order = "ORDER BY u.xp DESC, u.token_balance DESC"
    else:
        order = "ORDER BY u.token_balance DESC, u.xp DESC"
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            f"{base_select} {order} LIMIT $1",
            limit
        )
        result = []
        for row in rows:
            d = dict(row)
            d["wins"] = int(d["wins"] or 0)
            result.append(d)
        return result


async def search_users(query: str, limit: int = 50) -> List[Dict]:
    pattern = f"%{query}%"
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """SELECT * FROM users
               WHERE first_name ILIKE $1 OR telegram_username ILIKE $1
               ORDER BY token_balance DESC LIMIT $2""",
            pattern, limit
        )
        return _rows_to_list(rows)


async def get_all_users(limit: int = 200) -> List[Dict]:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM users ORDER BY token_balance DESC LIMIT $1", limit
        )
        return _rows_to_list(rows)


async def get_users_with_derived_address() -> List[Dict]:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM users WHERE derived_solana_address IS NOT NULL"
        )
        return _rows_to_list(rows)


async def check_duplicate_wallet(user_id: str, wallet_address: str) -> Optional[Dict]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM users WHERE id != $1 AND personal_solana_address = $2",
            user_id, wallet_address
        )
        return _row_to_dict(row)


# ─────────────────────────────────────────────────────────────────
# WINNER PRIZES
# ─────────────────────────────────────────────────────────────────

async def insert_winner_prize(prize_doc: Dict) -> bool:
    async with get_pool().acquire() as conn:
        try:
            await conn.execute("""
                INSERT INTO winner_prizes
                    (user_id, username, room_type, prize_link, bet_amount, total_pool, round_number, won_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            """,
                str(prize_doc.get('user_id', '')),
                prize_doc.get('username', ''),
                str(prize_doc.get('room_type', '')),
                prize_doc.get('prize_link', ''),
                int(prize_doc.get('bet_amount', 0)),
                int(prize_doc.get('total_pool', 0)),
                int(prize_doc.get('round_number', 1)),
                _to_dt(prize_doc.get('won_at')) or datetime.now(timezone.utc),
            )
            return True
        except Exception as e:
            logging.error(f"insert_winner_prize error: {e}")
            return False


async def get_user_prizes(user_id: str) -> List[Dict]:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM winner_prizes WHERE user_id = $1 ORDER BY won_at DESC",
            user_id
        )
        return _rows_to_list(rows)


async def get_recent_prizes(limit: int = 10) -> List[Dict]:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM winner_prizes ORDER BY won_at DESC LIMIT $1", limit
        )
        return _rows_to_list(rows)


# ─────────────────────────────────────────────────────────────────
# COMPLETED GAMES
# ─────────────────────────────────────────────────────────────────

async def insert_completed_game(game_doc: Dict) -> bool:
    async with get_pool().acquire() as conn:
        try:
            await conn.execute("""
                INSERT INTO completed_games
                    (id, room_type, players, status, prize_pool, winner,
                     prize_link, match_id, round_number, created_at, started_at, finished_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                ON CONFLICT (id) DO NOTHING
            """,
                str(game_doc.get('id', '')),
                str(game_doc.get('room_type', '')),
                _to_json(game_doc.get('players', [])),
                game_doc.get('status', 'finished'),
                int(game_doc.get('prize_pool', 0)),
                _to_json(game_doc.get('winner')),
                game_doc.get('prize_link'),
                game_doc.get('match_id'),
                int(game_doc.get('round_number', 1)),
                _to_dt(game_doc.get('created_at')) or datetime.now(timezone.utc),
                _to_dt(game_doc.get('started_at')),
                _to_dt(game_doc.get('finished_at')) or datetime.now(timezone.utc),
            )
            return True
        except Exception as e:
            logging.error(f"insert_completed_game error: {e}", exc_info=True)
            return False


async def get_user_completed_games(user_id: str, limit: int = 10) -> List[Dict]:
    """Return completed games where this user was a participant."""
    import json as _json
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM completed_games WHERE players @> $1::jsonb ORDER BY finished_at DESC LIMIT $2",
            _json.dumps([{"user_id": user_id}]), limit
        )
        return _rows_to_list(rows)


async def get_recent_completed_games(limit: int = 5) -> List[Dict]:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM completed_games ORDER BY finished_at DESC LIMIT $1", limit
        )
        return _rows_to_list(rows)


async def count_completed_games() -> int:
    async with get_pool().acquire() as conn:
        return await conn.fetchval("SELECT COUNT(*) FROM completed_games") or 0


async def delete_all_completed_games() -> int:
    async with get_pool().acquire() as conn:
        result = await conn.execute("DELETE FROM completed_games")
        return int(result.split()[-1])


# ─────────────────────────────────────────────────────────────────
# PENDING RESULTS
# ─────────────────────────────────────────────────────────────────

async def upsert_pending_result(user_id: str, result_doc: Dict) -> bool:
    async with get_pool().acquire() as conn:
        try:
            await conn.execute("""
                INSERT INTO pending_results
                    (user_id, match_id, winner, all_players, room_type, prize_pool, prize_link, finished_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            """,
                user_id,
                result_doc.get('match_id'),
                _to_json(result_doc.get('winner')),
                _to_json(result_doc.get('all_players', [])),
                str(result_doc.get('room_type', '')),
                int(result_doc.get('prize_pool', 0)),
                result_doc.get('prize_link'),
                _to_dt(result_doc.get('finished_at')) or datetime.now(timezone.utc),
            )
            return True
        except Exception as e:
            logging.error(f"upsert_pending_result error: {e}")
            return False


async def get_and_delete_pending_result(user_id: str) -> Optional[Dict]:
    """Returns all missed game results for user and deletes them."""
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            "DELETE FROM pending_results WHERE user_id = $1 RETURNING *", user_id
        )
        return _rows_to_list(rows)


# ─────────────────────────────────────────────────────────────────
# TOKEN PURCHASES
# ─────────────────────────────────────────────────────────────────

async def insert_token_purchase(purchase_doc: Dict) -> bool:
    async with get_pool().acquire() as conn:
        try:
            await conn.execute("""
                INSERT INTO token_purchases (user_id, sol_amount, token_amount, purchase_date)
                VALUES ($1,$2,$3,$4)
            """,
                str(purchase_doc.get('user_id', '')),
                purchase_doc.get('sol_amount'),
                int(purchase_doc.get('token_amount', 0)),
                _to_dt(purchase_doc.get('purchase_date')) or datetime.now(timezone.utc),
            )
            return True
        except Exception as e:
            logging.error(f"insert_token_purchase error: {e}")
            return False


async def get_token_purchases(user_id: str, limit: int = 10, offset: int = 0):
    async with get_pool().acquire() as conn:
        total = await conn.fetchval(
            "SELECT COUNT(*) FROM token_purchases WHERE user_id = $1", user_id
        ) or 0
        rows = await conn.fetch(
            "SELECT * FROM token_purchases WHERE user_id = $1 ORDER BY purchase_date DESC LIMIT $2 OFFSET $3",
            user_id, limit, offset
        )
        return _rows_to_list(rows), int(total)


# ─────────────────────────────────────────────────────────────────
# TEMPORARY WALLETS
# ─────────────────────────────────────────────────────────────────

async def get_temporary_wallet(wallet_address: str) -> Optional[Dict]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM temporary_wallets WHERE wallet_address = $1", wallet_address
        )
        return _row_to_dict(row)


async def insert_temporary_wallet(wallet_doc: Dict) -> bool:
    async with get_pool().acquire() as conn:
        try:
            await conn.execute("""
                INSERT INTO temporary_wallets
                    (wallet_address, user_id, required_sol, private_key, token_amount,
                     payment_detected, tokens_credited, sol_forwarded, status, created_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT (wallet_address) DO NOTHING
            """,
                wallet_doc.get('wallet_address', ''),
                str(wallet_doc.get('user_id', '')),
                wallet_doc.get('required_sol'),
                json.dumps(wallet_doc.get('private_key')),  # serialize list → JSON string for TEXT column
                wallet_doc.get('token_amount', 0),
                wallet_doc.get('payment_detected', False),
                wallet_doc.get('tokens_credited', False),
                wallet_doc.get('sol_forwarded', False),
                wallet_doc.get('status', 'pending'),
                _to_dt(wallet_doc.get('created_at')) or datetime.now(timezone.utc),
            )
            return True
        except Exception as e:
            logging.error(f"insert_temporary_wallet error: {e}")
            return False


async def update_temporary_wallet(wallet_address: str, fields: Dict) -> bool:
    if not fields:
        return False
    allowed = {
        'payment_detected', 'tokens_credited', 'sol_forwarded',
        'status', 'detected_at',
    }
    filtered = {k: v for k, v in fields.items() if k in allowed}
    if not filtered:
        return False
    async with get_pool().acquire() as conn:
        sets = ', '.join(f"{k} = ${i+2}" for i, k in enumerate(filtered))
        # Apply double-credit guard only when crediting tokens
        if 'tokens_credited' in filtered and filtered['tokens_credited']:
            condition = "AND tokens_credited = FALSE"
        else:
            condition = ""
        result = await conn.execute(
            f"UPDATE temporary_wallets SET {sets} WHERE wallet_address = $1 {condition}",
            wallet_address, *filtered.values()
        )
        rows_affected = int(result.split()[-1])
        return rows_affected > 0


async def count_pending_wallets() -> int:
    async with get_pool().acquire() as conn:
        return await conn.fetchval(
            "SELECT COUNT(*) FROM temporary_wallets WHERE status = 'pending'"
        ) or 0


async def get_all_temporary_wallets_monitoring() -> List[Dict]:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM temporary_wallets WHERE status IN ('pending', 'monitoring')"
        )
        return _rows_to_list(rows)


# ─────────────────────────────────────────────────────────────────
# ADMIN — new management functions
# ─────────────────────────────────────────────────────────────────

async def ban_user(telegram_id: int) -> bool:
    async with get_pool().acquire() as conn:
        result = await conn.execute(
            "UPDATE users SET is_banned = TRUE WHERE telegram_id = $1", telegram_id
        )
        return result == "UPDATE 1"


async def unban_user(telegram_id: int) -> bool:
    async with get_pool().acquire() as conn:
        result = await conn.execute(
            "UPDATE users SET is_banned = FALSE WHERE telegram_id = $1", telegram_id
        )
        return result == "UPDATE 1"


async def set_user_role(telegram_id: int, is_admin: bool, is_owner: bool) -> bool:
    role = "owner" if is_owner else ("admin" if is_admin else "user")
    async with get_pool().acquire() as conn:
        result = await conn.execute(
            "UPDATE users SET is_admin = $2, is_owner = $3, role = $4 WHERE telegram_id = $1",
            telegram_id, is_admin, is_owner, role
        )
        return result == "UPDATE 1"


async def get_admin_stats() -> Dict:
    async with get_pool().acquire() as conn:
        total_users     = await conn.fetchval("SELECT COUNT(*) FROM users") or 0
        total_tokens    = await conn.fetchval("SELECT COALESCE(SUM(token_balance), 0) FROM users") or 0
        total_games     = await conn.fetchval("SELECT COUNT(*) FROM completed_games") or 0
        games_today     = await conn.fetchval(
            "SELECT COUNT(*) FROM completed_games WHERE finished_at >= NOW() - INTERVAL '24 hours'"
        ) or 0
        tokens_sold     = await conn.fetchval(
            "SELECT COALESCE(SUM(token_amount), 0) FROM token_purchases"
        ) or 0
        total_wagered   = await conn.fetchval(
            "SELECT COALESCE(SUM(prize_pool), 0) FROM completed_games"
        ) or 0
        try:
            banned_count = await conn.fetchval(
                "SELECT COUNT(*) FROM users WHERE is_banned = TRUE"
            ) or 0
        except Exception:
            banned_count = 0
        admin_count     = await conn.fetchval(
            "SELECT COUNT(*) FROM users WHERE is_admin = TRUE OR is_owner = TRUE"
        ) or 0
        return {
            "total_users":      total_users,
            "tokens_in_circulation": total_tokens,
            "total_games":      total_games,
            "games_today":      games_today,
            "tokens_sold":      tokens_sold,
            "total_wagered":    total_wagered,
            "banned_users":     banned_count,
            "admin_count":      admin_count,
        }


# ─────────────────────────────────────────────────────────────────
# ADMIN — delete all data
# ─────────────────────────────────────────────────────────────────

async def get_all_telegram_ids() -> List[int]:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL")
        return [r["telegram_id"] for r in rows]


async def get_daily_stats(days: int = 7) -> List[Dict]:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                DATE(finished_at AT TIME ZONE 'UTC') as date,
                COUNT(*)::int as games,
                COALESCE(SUM(prize_pool), 0)::bigint as total_wagered
            FROM completed_games
            WHERE finished_at >= NOW() - ($1 || ' days')::INTERVAL
            GROUP BY DATE(finished_at AT TIME ZONE 'UTC')
            ORDER BY date ASC
        """, str(days))
        return [{"date": str(r["date"]), "games": r["games"], "total_wagered": int(r["total_wagered"])} for r in rows]


async def create_promo_code(code: str, token_amount: int, max_uses: int = 1, expires_at=None, unlimited: bool = False) -> bool:
    async with get_pool().acquire() as conn:
        try:
            await conn.execute("""
                INSERT INTO promo_codes (code, token_amount, max_uses, expires_at, unlimited)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (code) DO NOTHING
            """, code.upper(), token_amount, max_uses, expires_at, unlimited)
            return True
        except Exception as e:
            logging.error(f"create_promo_code error: {e}")
            return False


async def get_promo_codes() -> List[Dict]:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("SELECT * FROM promo_codes ORDER BY created_at DESC")
        result = []
        for r in rows:
            d = dict(r)
            for k in ('created_at', 'expires_at'):
                if d.get(k) and isinstance(d[k], datetime):
                    d[k] = d[k].isoformat()
            result.append(d)
        return result


async def delete_promo_code(code: str) -> bool:
    async with get_pool().acquire() as conn:
        result = await conn.execute("DELETE FROM promo_codes WHERE code = $1", code.upper())
        return result == "DELETE 1"


async def use_promo_code(code: str, telegram_id: int) -> Dict:
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            # Fetch promo — for unlimited codes skip uses_count < max_uses check
            promo = await conn.fetchrow("""
                SELECT * FROM promo_codes
                WHERE code = $1 AND is_active = TRUE
                  AND (expires_at IS NULL OR expires_at > NOW())
                  AND (unlimited = TRUE OR uses_count < max_uses)
                FOR UPDATE
            """, code.upper())
            if not promo:
                return {"success": False, "tokens": 0, "error": "Invalid or expired code"}
            # Per-user check applies to ALL codes (limited and unlimited)
            already = await conn.fetchval(
                "SELECT 1 FROM promo_uses WHERE code = $1 AND telegram_id = $2",
                code.upper(), telegram_id
            )
            if already:
                return {"success": False, "tokens": 0, "error": "ALREADY_REDEEMED"}
            # Record redemption — UNIQUE constraint prevents race conditions
            await conn.execute(
                "INSERT INTO promo_uses (code, telegram_id) VALUES ($1, $2)",
                code.upper(), telegram_id
            )
            await conn.execute(
                "UPDATE promo_codes SET uses_count = uses_count + 1 WHERE code = $1",
                code.upper()
            )
            await conn.execute(
                "UPDATE users SET token_balance = token_balance + $2 WHERE telegram_id = $1",
                telegram_id, promo["token_amount"]
            )
            return {"success": True, "tokens": promo["token_amount"], "error": ""}


async def get_user_stats(user_id: str) -> Dict:
    """Return play statistics for a single user."""
    async with get_pool().acquire() as conn:
        # Games played: user appears in players JSONB array
        games_played = await conn.fetchval(
            "SELECT COUNT(*) FROM completed_games WHERE players @> $1::jsonb",
            json.dumps([{"user_id": user_id}])
        ) or 0

        # Games won
        games_won = await conn.fetchval(
            "SELECT COUNT(*) FROM winner_prizes WHERE user_id = $1", user_id
        ) or 0

        # Total tokens wagered (sum of user's bet_amount across all games)
        total_wagered = await conn.fetchval("""
            SELECT COALESCE(SUM((p->>'bet_amount')::bigint), 0)
            FROM completed_games, jsonb_array_elements(players) p
            WHERE p->>'user_id' = $1
        """, user_id) or 0

        # Total tokens won (sum of prize pools where user won)
        total_won = await conn.fetchval(
            "SELECT COALESCE(SUM(total_pool), 0) FROM winner_prizes WHERE user_id = $1", user_id
        ) or 0

        # Biggest single win
        biggest_win = await conn.fetchval(
            "SELECT COALESCE(MAX(total_pool), 0) FROM winner_prizes WHERE user_id = $1", user_id
        ) or 0

        # Biggest single loss (biggest bet in a game where user lost)
        biggest_loss = await conn.fetchval("""
            SELECT COALESCE(MAX((p->>'bet_amount')::bigint), 0)
            FROM completed_games, jsonb_array_elements(players) p
            WHERE p->>'user_id' = $1
            AND (winner->>'user_id') != $1
        """, user_id) or 0

        # Favorite room (most played)
        fav_row = await conn.fetchrow("""
            SELECT room_type, COUNT(*) AS cnt
            FROM completed_games
            WHERE players @> $1::jsonb
            GROUP BY room_type ORDER BY cnt DESC LIMIT 1
        """, json.dumps([{"user_id": user_id}]))
        favorite_room = fav_row["room_type"] if fav_row else None

        # Recent wins (last 5)
        recent_wins_rows = await conn.fetch("""
            SELECT room_type, total_pool, bet_amount, won_at
            FROM winner_prizes WHERE user_id = $1
            ORDER BY won_at DESC LIMIT 5
        """, user_id)
        recent_wins = []
        for r in recent_wins_rows:
            recent_wins.append({
                "room_type": r["room_type"],
                "total_pool": int(r["total_pool"]),
                "bet_amount": int(r["bet_amount"]),
                "won_at": r["won_at"].isoformat() if r["won_at"] else None,
            })

        # Win streak — compute from chronological game history
        game_rows = await conn.fetch("""
            SELECT (winner->>'user_id') AS winner_id
            FROM completed_games
            WHERE players @> $1::jsonb
            ORDER BY finished_at ASC
        """, json.dumps([{"user_id": user_id}]))

        best_streak = 0
        current_streak = 0
        _cur = 0
        for row in game_rows:
            if row["winner_id"] == user_id:
                _cur += 1
                if _cur > best_streak:
                    best_streak = _cur
            else:
                _cur = 0
        current_streak = _cur  # streak at the end of history = current active streak

        win_rate = round(games_won / games_played * 100, 1) if games_played > 0 else 0.0

        return {
            "games_played": int(games_played),
            "games_won": int(games_won),
            "games_lost": int(games_played - games_won),
            "win_rate": win_rate,
            "total_wagered": int(total_wagered),
            "total_won": int(total_won),
            "net_profit": int(total_won - total_wagered),
            "biggest_win": int(biggest_win),
            "biggest_loss": int(biggest_loss),
            "best_win_streak": best_streak,
            "current_win_streak": current_streak,
            "favorite_room": favorite_room,
            "recent_wins": recent_wins,
        }


async def get_all_room_configs() -> List[Dict]:
    """Return all room configs from DB. Returns empty list if table is empty."""
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("SELECT * FROM room_configs ORDER BY room_type")
        return _rows_to_list(rows)


async def upsert_room_config(room_type: str, min_bet: int, max_bet: int, max_players: int, min_players: int) -> Dict:
    """Insert or update a room config row."""
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO room_configs (room_type, min_bet, max_bet, max_players, min_players)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (room_type) DO UPDATE
                SET min_bet = EXCLUDED.min_bet,
                    max_bet = EXCLUDED.max_bet,
                    max_players = EXCLUDED.max_players,
                    min_players = EXCLUDED.min_players
            RETURNING *
        """, room_type, min_bet, max_bet, max_players, min_players)
        return dict(row)


async def delete_all_data() -> Dict:
    async with get_pool().acquire() as conn:
        r_users     = await conn.execute("DELETE FROM users")
        r_games     = await conn.execute("DELETE FROM completed_games")
        r_prizes    = await conn.execute("DELETE FROM winner_prizes")
        r_pending   = await conn.execute("DELETE FROM pending_results")
        r_purchases = await conn.execute("DELETE FROM token_purchases")
        r_wallets   = await conn.execute("DELETE FROM temporary_wallets")
        return {
            "users":             int(r_users.split()[-1]),
            "completed_games":   int(r_games.split()[-1]),
            "winner_prizes":     int(r_prizes.split()[-1]),
            "pending_results":   int(r_pending.split()[-1]),
            "token_purchases":   int(r_purchases.split()[-1]),
            "temporary_wallets": int(r_wallets.split()[-1]),
        }
