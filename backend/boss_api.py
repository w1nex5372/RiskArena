"""
Boss Raid HTTP endpoints.
"""
import os
import random
import secrets as _secrets
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import boss_repo
import boss_domain as _boss_domain
from auth import get_authenticated_user_id, require_admin_request

_INTERNAL_SECRET = os.environ.get("INTERNAL_SECRET", "")


def _require_internal(request: Request) -> None:
    """Validates x-internal-secret header — called by Colyseus gameserver endpoints."""
    header = request.headers.get("x-internal-secret", "")
    if not _INTERNAL_SECRET:
        raise HTTPException(status_code=500, detail="INTERNAL_SECRET is not configured")
    if not _secrets.compare_digest(header, _INTERNAL_SECRET):
        raise HTTPException(status_code=403, detail="Unauthorized")

router = APIRouter(prefix="/boss-raid", tags=["boss-raid"])

# Set by server.py after sio is created — avoids circular imports
_sio = None


def set_sio(sio_instance) -> None:
    global _sio
    _sio = sio_instance


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, RuntimeError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=500, detail="Boss raid operation failed")


@router.get("/current")
async def get_current_boss(http_request: Request):
    """Return the active boss raid with top 3 dealers and the caller's total damage."""
    user_id = get_authenticated_user_id(http_request)
    try:
        state = await boss_repo.get_active_raid_state(user_id)
    except Exception as exc:
        raise _http_error(exc)
    if not state:
        raise HTTPException(status_code=404, detail="No active boss raid")
    return state


# NOTE: The legacy HTTP POST /boss-raid/attack endpoint was removed in Phase 6.
# Attacks are now fully owned by the Colyseus BossRaidRoom (room.send("attack")),
# which persists damage via /internal/record-damage. The old endpoint's Socket.IO
# emits (boss_update / damage_tick) are obsolete — the client reads HP from Colyseus
# delta-sync instead.


# ── Internal endpoints (called by Colyseus BossRaidRoom, not by clients) ─────

@router.get("/internal/active-state")
async def internal_active_state(http_request: Request):
    """
    Return the current active raid's basic state for Colyseus room sync.
    No user auth — validated by x-internal-secret header.
    """
    _require_internal(http_request)
    try:
        raid = await boss_repo.get_active_raid()
    except Exception as exc:
        raise _http_error(exc)
    if not raid:
        raise HTTPException(status_code=404, detail="No active boss raid")
    return {
        "id":         raid["id"],
        "name":       raid["name"],
        "current_hp": raid["current_hp"],
        "max_hp":     raid["max_hp"],
        "phase":      raid["phase"],
        "status":     raid["status"],
    }


class RecordDamageBody(BaseModel):
    raid_id: str = Field(..., min_length=1)
    user_id: str = Field(..., min_length=1)
    damage:  int = Field(..., ge=1, le=100_000)


class DefeatRaidBody(BaseModel):
    raid_id: str = Field(..., min_length=1)


@router.post("/internal/record-damage")
async def internal_record_damage(body: RecordDamageBody, http_request: Request):
    """
    Persist damage dealt by a Colyseus-managed attack.
    HP is NOT updated here — Colyseus owns authoritative HP.
    Called once per attack by BossRaidRoom.ts.
    """
    _require_internal(http_request)
    try:
        await boss_repo.record_damage_only(body.raid_id, body.user_id, body.damage)
    except Exception as exc:
        raise _http_error(exc)
    return {"ok": True}


@router.post("/internal/defeat")
async def internal_defeat_raid(body: DefeatRaidBody, http_request: Request):
    """
    Mark the raid as defeated and settle rewards.
    Called by BossRaidRoom.ts when HP reaches 0.
    Returns full rewards list so BossRaidRoom can broadcast directly to clients.
    Safe to call multiple times — idempotent via rewards_settled flag.
    """
    _require_internal(http_request)
    try:
        rewards = await boss_repo.defeat_raid(body.raid_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise _http_error(exc)

    raid = await boss_repo.get_raid(body.raid_id)
    boss_name = raid["name"] if raid else ""

    return {"ok": True, "rewards": rewards, "boss_name": boss_name}


@router.get("/internal/raid-result/{raid_id}")
async def internal_raid_result(raid_id: str, http_request: Request):
    """
    Return a finished raid's status + settled rewards.
    Called by BossRaidRoom.ts when it detects (via liveness poll) that its raid
    expired, so it can broadcast raid_finished with the same reward shape as defeat.
    """
    _require_internal(http_request)
    try:
        result = await boss_repo.get_raid_result(raid_id)
    except Exception as exc:
        raise _http_error(exc)
    if not result:
        raise HTTPException(status_code=404, detail="Raid not found")
    return result


class SpawnRaidRequest(BaseModel):
    name: str = ""
    level: int = 1


@router.post("/admin/spawn")
async def admin_spawn_raid(body: SpawnRaidRequest, http_request: Request):
    """Admin: manually spawn a new boss raid (for testing). Requires x-admin-key header."""
    require_admin_request(http_request)
    name = body.name.strip() or random.choice(_boss_domain.BOSS_NAMES)
    level = max(1, min(body.level, 10))
    try:
        raid = await boss_repo.spawn_raid(name, level)
    except Exception as exc:
        raise _http_error(exc)
    if _sio:
        await _sio.emit("boss_spawned", {
            "id": raid["id"],
            "name": raid["name"],
            "level": raid["level"],
            "max_hp": raid["max_hp"],
            "current_hp": raid["current_hp"],
            "phase": raid["phase"],
            "raid_end_at": raid["raid_end_at"],
        })
    return raid
