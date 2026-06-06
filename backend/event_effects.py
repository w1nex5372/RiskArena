from typing import Any, Dict


async def active_event_config(conn) -> Dict[str, Any]:
    try:
        rows = await conn.fetch(
            """
            SELECT config FROM game_events
            WHERE is_active = TRUE
              AND starts_at <= NOW()
              AND (ends_at IS NULL OR ends_at > NOW())
            """
        )
    except Exception:
        return {}
    merged: Dict[str, Any] = {}
    for row in rows:
        config = row["config"] or {}
        for key, value in dict(config).items():
            if key.endswith("_multiplier") and isinstance(value, (int, float)):
                merged[key] = max(float(merged.get(key, 1)), float(value))
            else:
                merged[key] = value
    return merged


async def multiplier(conn, key: str) -> float:
    config = await active_event_config(conn)
    value = config.get(key, 1)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 1.0
    return max(0.0, float(value or 1))


async def boosted_amount(conn, amount: int, key: str) -> int:
    return max(0, round(int(amount) * await multiplier(conn, key)))
