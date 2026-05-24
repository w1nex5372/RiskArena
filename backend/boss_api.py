"""
Boss Raid HTTP endpoints.
"""
import random
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import boss_repo
import boss_domain as _boss_domain
from auth import get_authenticated_user_id, require_admin_request

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


@router.post("/attack")
async def attack_boss(http_request: Request):
    """
    Deal one hit to the current active boss.
    Returns updated boss state.
    Emits boss_update to all clients after every hit.
    Emits raid_finished to all clients (with full rewards list) when the raid ends.
    """
    user_id = get_authenticated_user_id(http_request)
    try:
        state, rewards = await boss_repo.attack_boss(user_id)
    except Exception as exc:
        raise _http_error(exc)

    # Push live HP/phase update to every connected client
    if _sio:
        await _sio.emit("boss_update", {
            "id": state["id"],
            "current_hp": state["current_hp"],
            "max_hp": state["max_hp"],
            "phase": state["phase"],
            "status": state["status"],
            "top_dealers": state.get("top_dealers", []),
            "attacker_id": user_id,
            "my_damage": state.get("my_damage", 0),
            "player_count": state.get("player_count", 0),
        })

        # Raid just ended — broadcast result with all reward rows;
        # each client filters for its own user_id
        if rewards is not None:
            await _sio.emit("raid_finished", {
                "boss_name": state["name"],
                "status": state["status"],
                "rewards": rewards,
            })

    return state


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
