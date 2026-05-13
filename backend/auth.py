import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional

from fastapi import HTTPException, Request


SESSION_COOKIE = "arena_session"
SESSION_TTL_SECONDS = int(os.environ.get("SESSION_TTL_SECONDS", "86400"))
SESSION_SECRET = os.environ.get("SESSION_SECRET")


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def create_session_token(user_id: str) -> str:
    if not SESSION_SECRET:
        raise RuntimeError("SESSION_SECRET is required for session token signing")
    payload = {
        "user_id": str(user_id),
        "exp": int(time.time()) + SESSION_TTL_SECONDS,
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    payload_part = _b64encode(payload_bytes)
    signature = hmac.new(SESSION_SECRET.encode(), payload_part.encode(), hashlib.sha256).digest()
    return f"{payload_part}.{_b64encode(signature)}"


def verify_session_token(token: str) -> Optional[str]:
    if not SESSION_SECRET:
        return None
    if not token or "." not in token:
        return None
    payload_part, signature_part = token.split(".", 1)
    expected = hmac.new(SESSION_SECRET.encode(), payload_part.encode(), hashlib.sha256).digest()
    try:
        supplied = _b64decode(signature_part)
    except Exception:
        return None
    if not hmac.compare_digest(expected, supplied):
        return None
    try:
        payload = json.loads(_b64decode(payload_part))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    user_id = payload.get("user_id")
    return str(user_id) if user_id else None


def get_authenticated_user_id(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    token = ""
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    if not token:
        token = request.cookies.get(SESSION_COOKIE, "")
    user_id = verify_session_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


def verify_admin_key(admin_key: str) -> bool:
    expected = os.environ.get("ADMIN_KEY", "")
    return bool(expected) and hmac.compare_digest(admin_key or "", expected)


def require_admin_request(request: Request) -> None:
    admin_key = request.headers.get("x-admin-key", "")
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Admin authentication required")
