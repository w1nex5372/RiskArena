"""
Smoke tests for the Colyseus-facing internal boss raid endpoints.
These are pure-unit tests — no DB, no running server required.
"""
import os
import asyncio
import pytest
from pydantic import ValidationError

# ── Pydantic model validation ─────────────────────────────────────────────────

from boss_api import RecordDamageBody, DefeatRaidBody


def test_record_damage_body_valid():
    body = RecordDamageBody(raid_id="abc", user_id="user-1", damage=10)
    assert body.damage == 10


def test_record_damage_body_rejects_zero_damage():
    with pytest.raises(ValidationError):
        RecordDamageBody(raid_id="abc", user_id="user-1", damage=0)


def test_record_damage_body_rejects_negative_damage():
    with pytest.raises(ValidationError):
        RecordDamageBody(raid_id="abc", user_id="user-1", damage=-5)


def test_record_damage_body_rejects_missing_raid_id():
    with pytest.raises(ValidationError):
        RecordDamageBody(raid_id="", user_id="user-1", damage=10)


def test_defeat_body_valid():
    body = DefeatRaidBody(raid_id="some-uuid")
    assert body.raid_id == "some-uuid"


def test_defeat_body_rejects_empty_raid_id():
    with pytest.raises(ValidationError):
        DefeatRaidBody(raid_id="")


# ── Internal secret validation logic ─────────────────────────────────────────
# We test the _require_internal guard in isolation using a mock Request.

from unittest.mock import MagicMock
from fastapi import HTTPException


def _make_request(secret_header: str) -> MagicMock:
    req = MagicMock()
    req.headers = {"x-internal-secret": secret_header}
    return req


def test_require_internal_passes_with_correct_secret(monkeypatch):
    monkeypatch.setenv("INTERNAL_SECRET", "test-secret")
    # Re-import to pick up the env var (module-level constant)
    import importlib, boss_api
    importlib.reload(boss_api)

    # Should not raise
    boss_api._require_internal(_make_request("test-secret"))


def test_require_internal_raises_403_on_wrong_secret(monkeypatch):
    monkeypatch.setenv("INTERNAL_SECRET", "test-secret")
    import importlib, boss_api
    importlib.reload(boss_api)

    with pytest.raises(HTTPException) as exc:
        boss_api._require_internal(_make_request("wrong-secret"))
    assert exc.value.status_code == 403


def test_require_internal_raises_500_when_not_configured(monkeypatch):
    monkeypatch.delenv("INTERNAL_SECRET", raising=False)
    import importlib, boss_api
    importlib.reload(boss_api)

    with pytest.raises(HTTPException) as exc:
        boss_api._require_internal(_make_request("any"))
    assert exc.value.status_code == 500


class _FakeAcquire:
    def __init__(self, level):
        self.level = level

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def fetchval(self, *_args, **_kwargs):
        return self.level


class _FakePool:
    def __init__(self, level):
        self.level = level

    def acquire(self):
        return _FakeAcquire(self.level)


def test_require_raid_unlocked_blocks_low_level(monkeypatch):
    import boss_api
    monkeypatch.setattr(boss_api, "get_pool", lambda: _FakePool(4))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(boss_api._require_raid_unlocked("user-1"))
    assert exc.value.status_code == 423


def test_require_raid_unlocked_allows_level_five(monkeypatch):
    import boss_api
    monkeypatch.setattr(boss_api, "get_pool", lambda: _FakePool(5))

    asyncio.run(boss_api._require_raid_unlocked("user-1"))
