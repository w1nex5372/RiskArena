import asyncio
import inspect
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import daily_chest


class FixedRng:
    def __init__(self, ints, roll):
        self.ints = list(ints)
        self.roll = roll

    def randint(self, _low, _high):
        return self.ints.pop(0)

    def random(self):
        return self.roll


def test_chest_timing_uses_utc_calendar_day():
    now = datetime(2026, 5, 14, 23, 59, tzinfo=timezone.utc)

    assert daily_chest.current_chest_date(now).isoformat() == "2026-05-14"
    assert daily_chest.chest_timing(now) == {
        "chest_date": "2026-05-14",
        "reset_at": "2026-05-15T00:00:00Z",
        "next_available_at": "2026-05-15T00:00:00Z",
    }


@pytest.mark.parametrize(
    ("roll", "expected"),
    [
        (0.349, "common"),
        (0.499, "uncommon"),
        (0.549, "rare"),
        (0.569, "epic"),
        (0.572, "legendary"),
        (0.573, None),
    ],
)
def test_reward_chance_helper_returns_expected_tier(roll, expected):
    assert daily_chest.roll_item_tier(roll) == expected


def test_reward_roll_uses_expected_coin_xp_ranges_and_rng_order():
    reward = daily_chest.roll_daily_chest_reward(FixedRng([80, 20], 0.572))

    assert reward == {"coins": 80, "xp": 20, "item_tier": "legendary"}


def test_claim_sql_uses_unique_insert_conflict_gate():
    init_sql = (BACKEND_DIR / "init_db.py").read_text(encoding="utf-8")
    claim_source = inspect.getsource(daily_chest.claim_daily_chest_in_transaction)

    assert "CREATE TABLE IF NOT EXISTS daily_chest_claims" in init_sql
    assert "PRIMARY KEY (user_id, claim_date)" in init_sql
    assert "inventory_id VARCHAR(36) REFERENCES inventory(id) ON DELETE SET NULL" in init_sql
    assert "INSERT INTO daily_chest_claims" in claim_source
    assert "ON CONFLICT (user_id, claim_date) DO NOTHING" in claim_source
    assert "RETURNING user_id, claim_date" in claim_source


class FakeClaimConn:
    def __init__(self, claim_inserted=True, item=None):
        self.claim_inserted = claim_inserted
        self.item = item
        self.calls = []

    async def fetchrow(self, sql, *args):
        self.calls.append(("fetchrow", sql, args))
        compact_sql = " ".join(sql.split())
        if compact_sql.startswith("INSERT INTO daily_chest_claims"):
            return {"user_id": args[0], "claim_date": args[1]} if self.claim_inserted else None
        if compact_sql.startswith("UPDATE users"):
            return {"token_balance": 125, "xp": 110, "level": 2, "class_name": "mage"}
        if "FROM items" in compact_sql:
            return self.item
        raise AssertionError(f"Unexpected SQL: {compact_sql}")

    async def execute(self, sql, *args):
        self.calls.append(("execute", sql, args))
        return "OK"


def test_double_claim_does_not_award_twice():
    conn = FakeClaimConn(claim_inserted=False)

    with pytest.raises(ValueError, match="already claimed"):
        asyncio.run(
            daily_chest.claim_daily_chest_in_transaction(
                conn,
                "user-1",
                FixedRng([20, 5], 0.9),
                datetime(2026, 5, 14, 12, tzinfo=timezone.utc),
            )
        )

    assert len(conn.calls) == 1
    assert "UPDATE users" not in " ".join(call[1] for call in conn.calls)


def test_item_drop_inserts_owned_copy_with_inventory_id_semantics():
    item = {
        "id": 42,
        "name": "Crystal Staff",
        "class_name": "mage",
        "slot": "weapon",
        "tier": "uncommon",
    }
    conn = FakeClaimConn(item=item)

    result = asyncio.run(
        daily_chest.claim_daily_chest_in_transaction(
            conn,
            "user-1",
            FixedRng([55, 12], 0.49),
            datetime(2026, 5, 14, 12, tzinfo=timezone.utc),
        )
    )

    inventory_calls = [
        call for call in conn.calls
        if call[0] == "execute" and "INSERT INTO inventory" in call[1]
    ]
    assert len(inventory_calls) == 1
    insert_sql, insert_args = inventory_calls[0][1], inventory_calls[0][2]
    assert "item_id" in insert_sql
    assert "enchant_level" in insert_sql
    assert "'daily_chest'" in insert_sql
    assert insert_args[0] == result["inventory_id"]
    assert insert_args[1] == "user-1"
    assert insert_args[5] == 42
    assert result["item_drop"]["inventory_id"] == result["inventory_id"]
    assert result["item_drop"]["item_id"] == 42


class FakeItemSelectConn:
    def __init__(self):
        self.calls = []

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        return None


def test_class_drop_does_not_fallback_to_other_class_when_catalog_missing():
    conn = FakeItemSelectConn()

    item = asyncio.run(daily_chest._choose_drop_item(conn, "legendary", "mage"))

    assert item is None
    assert len(conn.calls) == 1
    assert conn.calls[0][1] == ("legendary", "mage")
    assert "class_name = $2" in conn.calls[0][0]


def test_xp_and_coins_update_is_atomic_incremental():
    conn = FakeClaimConn(item=None)

    result = asyncio.run(
        daily_chest.claim_daily_chest_in_transaction(
            conn,
            "user-1",
            FixedRng([21, 6], 0.9),
            datetime(2026, 5, 14, 12, tzinfo=timezone.utc),
        )
    )

    update_call = next(call for call in conn.calls if call[0] == "fetchrow" and "UPDATE users" in call[1])
    update_sql = " ".join(update_call[1].split())
    assert "token_balance = COALESCE(token_balance, 0) + $2" in update_sql
    assert "xp = COALESCE(xp, 0) + $3" in update_sql
    assert "level = CASE" in update_sql
    assert update_call[2] == ("user-1", 21, 6)
    assert result["reward_coins"] == 21
    assert result["reward_xp"] == 6
    assert result["new_balance"] == 125
    assert result["new_xp"] == 110
    assert result["new_level"] == 2
