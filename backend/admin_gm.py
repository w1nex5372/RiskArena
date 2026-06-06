import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import get_authenticated_user_id
from database import get_pool
from itemization import SCROLL_TYPES, can_user_equip_item, max_enchant_for_tier, tier_to_rarity
import progression


async def _require_gm_owner(request: Request) -> None:
    # A validated server-side admin key is used for trusted scripts. Interactive
    # Game Master access is owner-only because it can alter economies and events.
    if request.headers.get("x-admin-key"):
        return
    try:
        user_id = str(get_authenticated_user_id(request))
    except Exception as exc:
        raise HTTPException(status_code=403, detail="Owner access required") from exc
    async with get_pool().acquire() as conn:
        is_owner = await conn.fetchval(
            "SELECT is_owner OR role = 'owner' FROM users WHERE id = $1",
            user_id,
        )
    if not is_owner:
        raise HTTPException(status_code=403, detail="Owner access required")


router = APIRouter(prefix="/admin", dependencies=[Depends(_require_gm_owner)])


class GrantItemBody(BaseModel):
    item_id: int
    quantity: int = Field(default=1, ge=1, le=100)
    enchant_level: int = Field(default=0, ge=0, le=10)
    reason: str = Field(default="", max_length=500)


class BulkGrantBody(BaseModel):
    search: Optional[str] = None
    tier: Optional[str] = None
    class_name: Optional[str] = None
    slot: Optional[str] = None
    enchant_level: int = Field(default=0, ge=0, le=10)
    reason: str = Field(default="", max_length=500)


class BossSetGrantBody(BaseModel):
    tier: str
    class_name: str
    enchant_level: int = Field(default=0, ge=0, le=10)
    reason: str = Field(default="", max_length=500)


class InventoryPatchBody(BaseModel):
    enchant_level: Optional[int] = Field(default=None, ge=0, le=10)
    equipped: Optional[bool] = None
    reason: str = Field(default="", max_length=500)


class PlayerPatchBody(BaseModel):
    mode: str = "set"
    token_balance: Optional[int] = None
    diamonds: Optional[int] = None
    xp: Optional[int] = None
    level: Optional[int] = Field(default=None, ge=-99, le=100)
    energy: Optional[int] = Field(default=None, ge=0, le=1000)
    wins: Optional[int] = None
    losses: Optional[int] = None
    class_name: Optional[str] = None
    reason: str = Field(default="", max_length=500)


class ScrollPatchBody(BaseModel):
    scroll_type: str
    quantity: int
    mode: str = "set"
    reason: str = Field(default="", max_length=500)


class EventBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    event_type: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=1000)
    config: Dict[str, Any] = Field(default_factory=dict)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    is_active: bool = True


class EventPatchBody(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)
    config: Optional[Dict[str, Any]] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    is_active: Optional[bool] = None


EVENT_CONFIG_KEYS = {
    "double_xp": "xp_multiplier",
    "double_coins": "coin_multiplier",
    "legendary_drop_boost": "legendary_drop_multiplier",
}


def _validated_event_config(event_type: str, config: Dict[str, Any]) -> Dict[str, float]:
    expected_key = EVENT_CONFIG_KEYS.get(event_type)
    if not expected_key:
        raise HTTPException(status_code=400, detail="Unsupported event type")
    if set(config) != {expected_key}:
        raise HTTPException(status_code=400, detail=f"Event config must contain only {expected_key}")
    value = config.get(expected_key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0.1 <= float(value) <= 10:
        raise HTTPException(status_code=400, detail="Event multiplier must be a number between 0.1 and 10")
    return {expected_key: float(value)}


def _json(value: Any) -> Any:
    return json.loads(json.dumps(value or {}, default=str))


def _audit_entry(row: Any) -> Dict[str, Any]:
    entry = _json(dict(row))
    for field in ("before_data", "after_data", "metadata"):
        value = entry.get(field)
        if isinstance(value, str):
            try:
                entry[field] = json.loads(value)
            except json.JSONDecodeError:
                pass
    return entry


def _actor_id(request: Request) -> Optional[str]:
    try:
        return str(get_authenticated_user_id(request))
    except Exception:
        return None


def _require_reason(reason: str) -> str:
    cleaned = (reason or "").strip()
    if len(cleaned) < 3:
        raise HTTPException(status_code=400, detail="Audit reason must be at least 3 characters")
    return cleaned


def _target_level(current_level: int, requested_level: int, mode: str) -> int:
    target = current_level + requested_level if mode == "adjust" else requested_level
    return max(1, min(100, int(target)))


async def _audit(
    conn,
    request: Request,
    action: str,
    target_user_id: Optional[str] = None,
    reason: str = "",
    before: Any = None,
    after: Any = None,
    metadata: Any = None,
) -> None:
    audit_metadata = _json(metadata)
    audit_metadata["auth_method"] = "admin_key" if request.headers.get("x-admin-key") else "owner_session"
    await conn.execute(
        """
        INSERT INTO admin_audit_log
            (actor_user_id, target_user_id, action, reason, before_data, after_data, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
        """,
        _actor_id(request),
        target_user_id,
        action,
        (reason or "").strip(),
        json.dumps(_json(before)),
        json.dumps(_json(after)),
        json.dumps(audit_metadata),
    )


async def _player(conn, user_id: str):
    return await conn.fetchrow(
        """
        SELECT id, telegram_id, first_name, last_name, telegram_username, wallet_address,
               token_balance, diamonds, xp, level, energy, class_name, wins, losses,
               current_win_streak, max_win_streak, is_banned, is_admin, is_owner, role,
               created_at, last_login
        FROM users WHERE id = $1
        """,
        user_id,
    )


async def _inventory(conn, user_id: str):
    rows = await conn.fetch(
        """
        SELECT inv.id AS inventory_id, inv.item_id, inv.source, inv.enchant_level, inv.acquired_at,
               i.name, i.description, i.class_name, i.slot, i.tier, i.image_path,
               i.attack_bonus, i.ability_bonus, i.defend_reduction, i.hp_bonus,
               i.risk_win_chance, i.passive_type, i.passive_value,
               EXISTS (
                   SELECT 1 FROM equipped_items ei
                   JOIN users eu ON eu.id = ei.user_id
                   WHERE ei.user_id = inv.user_id AND ei.inventory_id = inv.id
                     AND ei.class_name = eu.class_name
               ) AS equipped
        FROM inventory inv
        JOIN items i ON i.id = inv.item_id
        WHERE inv.user_id = $1
        ORDER BY inv.acquired_at DESC, inv.id DESC
        """,
        user_id,
    )
    return [_json(dict(row)) for row in rows]


@router.get("/players")
async def search_players(search: str = "", limit: int = 30):
    limit = max(1, min(int(limit or 30), 100))
    term = (search or "").strip()
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, telegram_id, first_name, last_name, telegram_username,
                   token_balance, diamonds, xp, level, energy, class_name,
                   wins, losses, is_banned, is_admin, is_owner, last_login
            FROM users
            WHERE $1 = '' OR id = $1 OR CAST(telegram_id AS TEXT) = $1
               OR COALESCE(telegram_username, '') ILIKE '%' || $1 || '%'
               OR COALESCE(first_name, '') ILIKE '%' || $1 || '%'
               OR COALESCE(last_name, '') ILIKE '%' || $1 || '%'
               OR COALESCE(wallet_address, '') ILIKE '%' || $1 || '%'
            ORDER BY last_login DESC LIMIT $2
            """,
            term,
            limit,
        )
    return {"players": [_json(dict(row)) for row in rows]}


@router.get("/players/{user_id}")
async def get_player(user_id: str):
    async with get_pool().acquire() as conn:
        user = await _player(conn, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Player not found")
        inventory = await _inventory(conn, user_id)
        scrolls = await conn.fetch("SELECT scroll_type, quantity FROM item_scrolls WHERE user_id = $1", user_id)
        audits = await conn.fetch(
            """
            SELECT id, actor_user_id, action, reason, before_data, after_data, metadata, created_at
            FROM admin_audit_log WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT 30
            """,
            user_id,
        )
    return {
        "user": _json(dict(user)),
        "inventory": inventory,
        "scrolls": {row["scroll_type"]: int(row["quantity"]) for row in scrolls},
        "audit": [_audit_entry(row) for row in audits],
    }


@router.get("/item-catalog")
async def item_catalog(search: str = "", tier: str = "", class_name: str = "", slot: str = ""):
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM items
            WHERE ($1 = '' OR name ILIKE '%' || $1 || '%')
              AND ($2 = '' OR tier = $2)
              AND ($3 = '' OR class_name = $3 OR ($3 <> 'any' AND class_name = 'any'))
              AND ($4 = '' OR slot = $4)
            ORDER BY CASE tier WHEN 'legendary' THEN 5 WHEN 'epic' THEN 4
                WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 2 ELSE 1 END DESC,
                class_name, slot, name
            """,
            search.strip(), tier.strip().lower(), class_name.strip().lower(), slot.strip().lower(),
        )
    return {"items": [_json(dict(row)) for row in rows]}


async def _insert_inventory_item(conn, user_id: str, item: Any, enchant_level: int, source: str) -> str:
    inventory_id = str(uuid.uuid4())
    level = min(enchant_level, max_enchant_for_tier(item["tier"]))
    await conn.execute(
        """
        INSERT INTO inventory
            (id, user_id, item_type, item_name, item_rarity, equipped,
             item_id, source, enchant_level, acquired_at)
        VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, $8, NOW())
        """,
        inventory_id, user_id, item["slot"], item["name"],
        tier_to_rarity(item["tier"]), item["id"], source, level,
    )
    return inventory_id


@router.post("/players/{user_id}/items")
async def grant_item(user_id: str, body: GrantItemBody, request: Request):
    reason = _require_reason(body.reason)
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            item = await conn.fetchrow("SELECT * FROM items WHERE id = $1", body.item_id)
            if not await _player(conn, user_id) or not item:
                raise HTTPException(status_code=404, detail="Player or item not found")
            level = min(body.enchant_level, max_enchant_for_tier(item["tier"]))
            inventory_ids = []
            for _ in range(body.quantity):
                inventory_ids.append(await _insert_inventory_item(conn, user_id, item, level, "admin_grant"))
            await _audit(
                conn, request, "grant_item", user_id, reason,
                after={"item_id": item["id"], "name": item["name"], "quantity": body.quantity, "enchant_level": level},
                metadata={"inventory_ids": inventory_ids},
            )
    return {"success": True, "granted": len(inventory_ids)}


@router.post("/players/{user_id}/items/boss-set")
async def grant_boss_set(user_id: str, body: BossSetGrantBody, request: Request):
    reason = _require_reason(body.reason)
    tier = body.tier.strip().lower()
    class_name = body.class_name.strip().lower()
    if tier not in {"epic", "legendary"} or class_name not in {"warrior", "mage", "rogue"}:
        raise HTTPException(status_code=400, detail="Boss set requires an epic/legendary tier and a playable class")
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            if not await _player(conn, user_id):
                raise HTTPException(status_code=404, detail="Player not found")
            rows = await conn.fetch(
                """
                SELECT DISTINCT ON (slot) *
                FROM items
                WHERE tier = $1
                  AND (
                    (class_name = $2 AND slot IN ('weapon', 'armor', 'ability'))
                    OR (class_name = 'any' AND slot = 'helmet')
                  )
                ORDER BY slot, CASE WHEN class_name = $2 THEN 0 ELSE 1 END, name
                """,
                tier, class_name,
            )
            by_slot = {row["slot"]: row for row in rows}
            missing = {"weapon", "armor", "ability", "helmet"} - set(by_slot)
            if missing:
                raise HTTPException(status_code=409, detail=f"Boss set catalog is incomplete: {', '.join(sorted(missing))}")
            inventory_ids = [
                await _insert_inventory_item(conn, user_id, by_slot[slot], body.enchant_level, "admin_boss_set")
                for slot in ("weapon", "armor", "ability", "helmet")
            ]
            names = [by_slot[slot]["name"] for slot in ("weapon", "armor", "ability", "helmet")]
            await _audit(
                conn, request, "grant_boss_set", user_id, reason,
                after={"tier": tier, "class_name": class_name, "count": 4, "items": names},
                metadata={"inventory_ids": inventory_ids},
            )
    return {"success": True, "granted": 4, "items": names, "inventory_ids": inventory_ids}


@router.post("/players/{user_id}/items/bulk")
async def bulk_grant_items(user_id: str, body: BulkGrantBody, request: Request):
    reason = _require_reason(body.reason)
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            if not await _player(conn, user_id):
                raise HTTPException(status_code=404, detail="Player not found")
            rows = await conn.fetch(
                """
                SELECT id, name, class_name, slot, tier FROM items
                WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%')
                  AND ($2::text IS NULL OR tier = $2)
                  AND ($3::text IS NULL OR class_name = $3)
                  AND ($4::text IS NULL OR slot = $4)
                ORDER BY id
                """,
                body.search.strip() if body.search else None,
                body.tier.lower() if body.tier else None,
                body.class_name.lower() if body.class_name else None,
                body.slot.lower() if body.slot else None,
            )
            for item in rows:
                await _insert_inventory_item(conn, user_id, item, body.enchant_level, "admin_bulk_grant")
            await _audit(conn, request, "bulk_grant_items", user_id, reason, after={
                "count": len(rows), "search": body.search, "tier": body.tier,
                "class_name": body.class_name, "slot": body.slot,
            })
    return {"success": True, "granted": len(rows)}


@router.patch("/players/{user_id}/inventory/{inventory_id}")
async def patch_inventory(user_id: str, inventory_id: str, body: InventoryPatchBody, request: Request):
    reason = _require_reason(body.reason)
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT inv.id AS inventory_id, inv.enchant_level, inv.item_id,
                       i.name, i.slot, i.tier, i.class_name, u.class_name AS user_class
                FROM inventory inv JOIN items i ON i.id = inv.item_id
                JOIN users u ON u.id = inv.user_id
                WHERE inv.user_id = $1 AND inv.id = $2 FOR UPDATE
                """,
                user_id, inventory_id,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Inventory item not found")
            before = dict(row)
            if body.enchant_level is not None:
                level = min(body.enchant_level, max_enchant_for_tier(row["tier"]))
                await conn.execute("UPDATE inventory SET enchant_level = $3 WHERE user_id = $1 AND id = $2", user_id, inventory_id, level)
            if body.equipped is True:
                if not can_user_equip_item(row["user_class"], row["class_name"], row["slot"]):
                    raise HTTPException(status_code=400, detail="Item cannot be equipped by the current class")
                await conn.execute(
                    """
                    INSERT INTO equipped_items (user_id, slot, inventory_id, item_id, equipped_at, class_name)
                    VALUES ($1, $2, $3, $4, NOW(), $5)
                    ON CONFLICT (user_id, slot, class_name) DO UPDATE SET
                        inventory_id = EXCLUDED.inventory_id, item_id = EXCLUDED.item_id, equipped_at = NOW()
                    """,
                    user_id, row["slot"], inventory_id, row["item_id"], row["user_class"] or "",
                )
            elif body.equipped is False:
                await conn.execute("DELETE FROM equipped_items WHERE user_id = $1 AND inventory_id = $2", user_id, inventory_id)
            after = body.model_dump()
            if body.enchant_level is not None:
                after["enchant_level"] = level
            await _audit(conn, request, "patch_inventory_item", user_id, reason, before, after)
    return {"success": True}


@router.delete("/players/{user_id}/inventory/{inventory_id}")
async def delete_inventory(user_id: str, inventory_id: str, request: Request, reason: str = ""):
    reason = _require_reason(reason)
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("SELECT * FROM inventory WHERE user_id = $1 AND id = $2 FOR UPDATE", user_id, inventory_id)
            if not row:
                raise HTTPException(status_code=404, detail="Inventory item not found")
            await conn.execute("DELETE FROM equipped_items WHERE user_id = $1 AND inventory_id = $2", user_id, inventory_id)
            await conn.execute("DELETE FROM inventory WHERE user_id = $1 AND id = $2", user_id, inventory_id)
            await _audit(conn, request, "delete_inventory_item", user_id, reason, before=dict(row))
    return {"success": True}


@router.patch("/players/{user_id}")
async def patch_player(user_id: str, body: PlayerPatchBody, request: Request):
    reason = _require_reason(body.reason)
    if body.mode not in {"set", "adjust"}:
        raise HTTPException(status_code=400, detail="mode must be set or adjust")
    if body.class_name is not None and body.class_name not in {"warrior", "mage", "rogue"}:
        raise HTTPException(status_code=400, detail="Invalid class")
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("SELECT * FROM users WHERE id = $1 FOR UPDATE", user_id)
            if not row:
                raise HTTPException(status_code=404, detail="Player not found")
            values = {}
            for field in ("token_balance", "diamonds", "xp", "energy", "wins", "losses"):
                requested = getattr(body, field)
                current = int(row[field] or 0)
                values[field] = current if requested is None else (current + requested if body.mode == "adjust" else requested)
                values[field] = max(0, int(values[field]))
            if body.level is not None:
                values["level"] = _target_level(int(row["level"] or 1), body.level, body.mode)
                values["xp"] = progression.xp_for_level(values["level"])
            else:
                values["level"] = progression.level_for_xp(values["xp"])
            values["class_name"] = body.class_name if body.class_name is not None else row["class_name"]
            updated = await conn.fetchrow(
                """
                UPDATE users SET token_balance = $2, diamonds = $3, xp = $4, level = $5,
                    energy = $6, wins = $7, losses = $8, class_name = $9
                WHERE id = $1 RETURNING id, telegram_id, token_balance, diamonds, xp, level,
                    energy, wins, losses, class_name
                """,
                user_id, values["token_balance"], values["diamonds"], values["xp"], values["level"],
                values["energy"], values["wins"], values["losses"], values["class_name"],
            )
            await _audit(conn, request, "patch_player", user_id, reason, before=dict(row), after=dict(updated))
    return {"success": True, "user": _json(dict(updated))}


@router.patch("/players/{user_id}/scrolls")
async def patch_scrolls(user_id: str, body: ScrollPatchBody, request: Request):
    reason = _require_reason(body.reason)
    if body.scroll_type not in SCROLL_TYPES or body.mode not in {"set", "adjust"}:
        raise HTTPException(status_code=400, detail="Invalid scroll type or mode")
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            current = int(await conn.fetchval(
                "SELECT quantity FROM item_scrolls WHERE user_id = $1 AND scroll_type = $2 FOR UPDATE",
                user_id, body.scroll_type,
            ) or 0)
            quantity = max(0, current + body.quantity if body.mode == "adjust" else body.quantity)
            quantity = int(await conn.fetchval(
                """
                INSERT INTO item_scrolls (user_id, scroll_type, quantity, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (user_id, scroll_type) DO UPDATE SET
                    quantity = CASE WHEN $4 = 'adjust'
                        THEN GREATEST(0, item_scrolls.quantity + $5)
                        ELSE $3 END,
                    updated_at = NOW()
                RETURNING quantity
                """,
                user_id, body.scroll_type, quantity, body.mode, body.quantity,
            ))
            await _audit(conn, request, "patch_scrolls", user_id, reason, before={"quantity": current}, after={"quantity": quantity, "scroll_type": body.scroll_type})
    return {"success": True, "quantity": quantity}


@router.post("/players/{user_id}/reset-daily")
async def reset_daily(user_id: str, request: Request, confirm: bool = False, reason: str = ""):
    reason = _require_reason(reason)
    if not confirm:
        raise HTTPException(status_code=400, detail="Daily reset requires explicit confirmation")
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM daily_quest_progress WHERE user_id = $1", user_id)
            await conn.execute("DELETE FROM daily_chest_claims WHERE user_id = $1", user_id)
            await conn.execute("UPDATE users SET last_daily_claim = NULL WHERE id = $1", user_id)
            await _audit(conn, request, "reset_daily", user_id, reason)
    return {"success": True}


@router.get("/audit-log")
async def audit_log(limit: int = 100):
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT l.*, u.first_name AS target_first_name, u.telegram_username AS target_username
            FROM admin_audit_log l LEFT JOIN users u ON u.id = l.target_user_id
            ORDER BY l.created_at DESC LIMIT $1
            """,
            max(1, min(int(limit or 100), 500)),
        )
    return {"entries": [_audit_entry(row) for row in rows]}


@router.get("/events")
async def list_events():
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("SELECT * FROM game_events ORDER BY created_at DESC")
    return {"events": [_json(dict(row)) for row in rows]}


@router.post("/events")
async def create_event(body: EventBody, request: Request):
    starts_at = body.starts_at or datetime.now(timezone.utc)
    if body.ends_at and body.ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="Event end must be after start")
    config = _validated_event_config(body.event_type, body.config)
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            if body.is_active and await conn.fetchval(
                """
                SELECT EXISTS (
                    SELECT 1 FROM game_events
                    WHERE event_type = $1 AND is_active = TRUE
                      AND starts_at < COALESCE($3, 'infinity'::timestamptz)
                      AND COALESCE(ends_at, 'infinity'::timestamptz) > $2
                )
                """,
                body.event_type, starts_at, body.ends_at,
            ):
                raise HTTPException(status_code=409, detail="An overlapping active event of this type already exists")
            row = await conn.fetchrow(
                """
                INSERT INTO game_events (id, name, event_type, description, config, starts_at, ends_at, is_active, created_by)
                VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) RETURNING *
                """,
                str(uuid.uuid4()), body.name, body.event_type, body.description, json.dumps(config),
                starts_at, body.ends_at, body.is_active, _actor_id(request),
            )
            await _audit(conn, request, "create_event", reason=body.description, after=dict(row))
    return {"event": _json(dict(row))}


@router.patch("/events/{event_id}")
async def patch_event(event_id: str, body: EventPatchBody, request: Request):
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            before = await conn.fetchrow("SELECT * FROM game_events WHERE id = $1 FOR UPDATE", event_id)
            if not before:
                raise HTTPException(status_code=404, detail="Event not found")
            values = dict(before)
            for field in ("name", "description", "config", "starts_at", "ends_at", "is_active"):
                value = getattr(body, field)
                if value is not None:
                    values[field] = value
            if values["ends_at"] and values["ends_at"] <= values["starts_at"]:
                raise HTTPException(status_code=400, detail="Event end must be after start")
            values["config"] = _validated_event_config(before["event_type"], _json(values["config"]))
            if values["is_active"] and await conn.fetchval(
                """
                SELECT EXISTS (
                    SELECT 1 FROM game_events
                    WHERE id <> $1 AND event_type = $2 AND is_active = TRUE
                      AND starts_at < COALESCE($4, 'infinity'::timestamptz)
                      AND COALESCE(ends_at, 'infinity'::timestamptz) > $3
                )
                """,
                event_id, before["event_type"], values["starts_at"], values["ends_at"],
            ):
                raise HTTPException(status_code=409, detail="An overlapping active event of this type already exists")
            row = await conn.fetchrow(
                """
                UPDATE game_events SET name = $2, description = $3, config = $4::jsonb,
                    starts_at = $5, ends_at = $6, is_active = $7, updated_at = NOW()
                WHERE id = $1 RETURNING *
                """,
                event_id, values["name"], values["description"], json.dumps(_json(values["config"])),
                values["starts_at"], values["ends_at"], values["is_active"],
            )
            await _audit(conn, request, "patch_event", before=dict(before), after=dict(row))
    return {"event": _json(dict(row))}


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, request: Request):
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            before = await conn.fetchrow("DELETE FROM game_events WHERE id = $1 RETURNING *", event_id)
            if not before:
                raise HTTPException(status_code=404, detail="Event not found")
            await _audit(conn, request, "delete_event", before=dict(before))
    return {"success": True}
