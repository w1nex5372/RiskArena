import time

import pytest

from auth import create_session_token, verify_session_token


@pytest.fixture(autouse=True)
def session_secret(monkeypatch):
    monkeypatch.setattr("auth.SESSION_SECRET", "test-secret")


def test_session_token_round_trip():
    token = create_session_token("user-1")

    assert verify_session_token(token) == "user-1"


def test_session_token_rejects_tampering():
    token = create_session_token("user-1")
    payload, signature = token.split(".", 1)

    assert verify_session_token(f"{payload}x.{signature}") is None


def test_session_token_rejects_expired_payload(monkeypatch):
    now = int(time.time())
    monkeypatch.setattr("auth.SESSION_TTL_SECONDS", -1)
    token = create_session_token("user-1")
    monkeypatch.setattr(time, "time", lambda: now + 10)

    assert verify_session_token(token) is None
