from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import arena_repo
from auth import get_authenticated_user_id, require_admin_request
from arena_domain import VALID_ACTIONS
from arena_view import redact_match_for_user


router = APIRouter(prefix="/arena", tags=["arena"])


class CreateDuelRequest(BaseModel):
    player_one_id: str
    player_two_id: str
    stake_amount: int = Field(gt=0, le=1_000_000)


class SubmitActionRequest(BaseModel):
    round_number: int = Field(gt=0)
    action: str


def _http_error(exc: Exception) -> HTTPException:
    message = str(exc)
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=message)
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=message)
    if isinstance(exc, (ValueError, ArithmeticError)):
        return HTTPException(status_code=400, detail=message)
    if isinstance(exc, RuntimeError):
        return HTTPException(status_code=409, detail=message)
    return HTTPException(status_code=500, detail="Arena operation failed")


@router.post("/duels")
async def create_duel(request: CreateDuelRequest, http_request: Request):
    require_admin_request(http_request)
    try:
        return await arena_repo.create_duel(
            request.player_one_id,
            request.player_two_id,
            request.stake_amount,
        )
    except Exception as exc:
        raise _http_error(exc)


@router.get("/matches/{match_id}")
async def get_match(match_id: str, http_request: Request):
    authenticated_user_id = get_authenticated_user_id(http_request)
    match = await arena_repo.get_match(match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Arena match not found")
    try:
        return redact_match_for_user(match, authenticated_user_id)
    except Exception as exc:
        raise _http_error(exc)


@router.post("/matches/{match_id}/actions")
async def submit_action(match_id: str, request: SubmitActionRequest, http_request: Request):
    if request.action.strip().lower() not in VALID_ACTIONS:
        raise HTTPException(status_code=400, detail="Invalid arena action")
    authenticated_user_id = get_authenticated_user_id(http_request)
    try:
        return await arena_repo.submit_action(
            match_id,
            authenticated_user_id,
            request.round_number,
            request.action,
        )
    except Exception as exc:
        raise _http_error(exc)


@router.post("/matches/{match_id}/resolve-timeout")
async def resolve_timeout(match_id: str, http_request: Request):
    authenticated_user_id = get_authenticated_user_id(http_request)
    try:
        return await arena_repo.resolve_timeout(match_id, requester_user_id=authenticated_user_id)
    except Exception as exc:
        raise _http_error(exc)
