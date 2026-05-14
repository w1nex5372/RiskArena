import asyncio
import ast
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

sys.modules.setdefault("database", SimpleNamespace(get_pool=lambda: None))

import daily_quests


def test_quest_timing_uses_utc_calendar_day():
    now = datetime(2026, 5, 14, 23, 30, tzinfo=timezone.utc)

    assert daily_quests.current_quest_date(now).isoformat() == "2026-05-14"
    assert daily_quests.quest_timing(now) == {
        "quest_date": "2026-05-14",
        "reset_at": "2026-05-15T00:00:00Z",
    }


def test_naive_quest_datetime_is_treated_as_utc():
    now = datetime(2026, 5, 14, 23, 30)

    assert daily_quests.current_quest_date(now).isoformat() == "2026-05-14"


class FakeClaimConn:
    def __init__(self, claim_row, updated_user, existing_progress=None):
        self.claim_row = claim_row
        self.updated_user = updated_user
        self.existing_progress = existing_progress
        self.calls = []

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        compact_sql = " ".join(sql.split())
        if compact_sql.startswith("UPDATE daily_quest_progress"):
            return self.claim_row
        if compact_sql.startswith("UPDATE users"):
            return self.updated_user
        if compact_sql.startswith("SELECT completed, claimed"):
            return self.existing_progress
        raise AssertionError(f"Unexpected SQL: {compact_sql}")


def test_claim_helper_marks_and_awards_in_expected_order(monkeypatch):
    monkeypatch.setattr(daily_quests, "current_quest_date", lambda: "2026-05-14")
    conn = FakeClaimConn(
        claim_row={"quest_key": "play_match"},
        updated_user={"token_balance": 40, "xp": 105, "level": 2},
    )

    result = asyncio.run(daily_quests.claim_quest_in_transaction(conn, "user-1", "play_match"))

    assert result == {
        "success": True,
        "reward_coins": 30,
        "reward_xp": 10,
        "new_balance": 40,
        "new_xp": 105,
        "new_level": 2,
    }
    claim_sql, claim_args = conn.calls[0]
    assert "UPDATE daily_quest_progress" in claim_sql
    assert "completed = TRUE" in claim_sql
    assert "claimed = FALSE" in claim_sql
    assert "RETURNING quest_key" in claim_sql
    assert claim_args == ("user-1", "2026-05-14", "play_match")
    reward_sql, reward_args = conn.calls[1]
    compact_reward_sql = " ".join(reward_sql.split())
    assert compact_reward_sql.startswith("UPDATE users")
    assert "xp = COALESCE(xp, 0) + $3" in compact_reward_sql
    assert "level = CASE" in compact_reward_sql
    assert reward_args == ("user-1", 30, 10)


def test_claim_helper_does_not_award_when_claim_update_misses(monkeypatch):
    monkeypatch.setattr(daily_quests, "current_quest_date", lambda: "2026-05-14")
    conn = FakeClaimConn(
        claim_row=None,
        updated_user={"token_balance": 40, "xp": 0, "level": 1},
        existing_progress={"completed": True, "claimed": True},
    )

    with pytest.raises(ValueError, match="Already claimed"):
        asyncio.run(daily_quests.claim_quest_in_transaction(conn, "user-1", "play_match"))

    assert len(conn.calls) == 2
    assert "UPDATE users" not in conn.calls[-1][0]


def test_claim_endpoint_wraps_helper_in_transaction():
    server_path = BACKEND_DIR / "server.py"
    tree = ast.parse(server_path.read_text(encoding="utf-8"))
    claim_func = next(
        node for node in tree.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "claim_daily_quest"
    )

    transaction_with = next(
        node for node in ast.walk(claim_func)
        if isinstance(node, ast.AsyncWith)
        and any(
            isinstance(item.context_expr, ast.Call)
            and isinstance(item.context_expr.func, ast.Attribute)
            and item.context_expr.func.attr == "transaction"
            for item in node.items
        )
    )
    helper_calls = [
        node for node in ast.walk(claim_func)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "claim_quest_in_transaction"
    ]

    assert helper_calls
    assert any(call in ast.walk(transaction_with) for call in helper_calls)
