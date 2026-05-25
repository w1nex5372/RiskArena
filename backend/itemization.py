"""
Shared itemization definitions and pure helper functions.

This module owns the canonical item catalog, shop/drop rules, stat aggregation,
and passive parsing so backend systems consume one deterministic source of truth.
"""
import json
from dataclasses import asdict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from arena_domain import ItemModifiers

VALID_CLASSES = ("warrior", "mage", "rogue")
VALID_SLOTS = ("weapon", "armor", "ability")
VALID_TIERS = ("common", "uncommon", "rare", "epic", "legendary")
ENCHANTABLE_SLOTS = {"weapon", "armor"}
SCROLL_TYPES = {"normal_scroll", "blessed_scroll"}
SHOP_TIERS = {"common", "uncommon", "rare"}
DROP_ONLY_TIERS = {"epic", "legendary"}
PASSIVE_TYPES = {
    "bonus_attack_percent",
    "bonus_ability_percent",
    "damage_reduction_percent",
    "risk_success_bonus",
    "boss_damage_percent",
    "lifesteal_percent",
}
TIER_TO_RARITY = {
    "common": "Common",
    "uncommon": "Uncommon",
    "rare": "Rare",
    "epic": "Epic",
    "legendary": "Legendary",
}
TIER_PRICE = {
    "common": 150,
    "uncommon": 500,
    "rare": 1500,
    "epic": 0,
    "legendary": 0,
}
ENCHANT_MAX_BY_TIER = {
    "common": 10,
    "uncommon": 10,
    "rare": 10,
    "epic": 10,
    "legendary": 10,
}
ENCHANT_SAFE_BY_TIER = {
    "common": 0,
    "uncommon": 0,
    "rare": 0,
    "epic": 0,
    "legendary": 0,
}
ENCHANT_BASE_CHANCE_BY_TIER = {
    "common": 0.92,
    "uncommon": 0.86,
    "rare": 0.78,
    "epic": 0.68,
    "legendary": 0.58,
}
ENCHANT_DECAY_BY_LEVEL = {
    "common": 0.08,
    "uncommon": 0.08,
    "rare": 0.07,
    "epic": 0.06,
    "legendary": 0.05,
}
ENCHANT_MIN_CHANCE_BY_TIER = {
    "common": 0.35,
    "uncommon": 0.30,
    "rare": 0.25,
    "epic": 0.20,
    "legendary": 0.15,
}
SCROLL_SHOP = {
    "normal_scroll": {
        "scroll_type": "normal_scroll",
        "name": "Enchant Scroll",
        "price": 250,
        "purchasable": True,
    },
    "blessed_scroll": {
        "scroll_type": "blessed_scroll",
        "name": "Blessed Enchant Scroll",
        "price": 2000,
        "purchasable": False,
    },
}

STAT_KEYS = (
    "attack_bonus",
    "ability_bonus",
    "defend_reduction",
    "hp_bonus",
    "risk_win_chance",
    "bonus_attack_percent",
    "bonus_ability_percent",
    "damage_reduction_percent",
    "risk_success_bonus",
    "boss_damage_percent",
    "lifesteal_percent",
)
BASE_STAT_KEYS = (
    "attack_bonus",
    "ability_bonus",
    "defend_reduction",
    "hp_bonus",
    "risk_win_chance",
)


_WEAPON_ASSET = {"warrior": "warrior_katana", "mage": "mage_staff", "rogue": "rogue_scimitar"}
_LPC_WEAPON_ASSET = {
    "warrior": "weapon.sword.katana",
    "mage": "weapon.staff.mage_staff",
    "rogue": "weapon.sword.scimitar",
}


def _weapon_image(class_name: str, slot: str) -> str:
    if slot == "weapon":
        return f"/items/{_WEAPON_ASSET.get(class_name, class_name + '_weapon')}.png"
    return f"/items/{class_name}_{slot}.png"


def _lpc_visual(class_name: str, slot: str) -> Optional[Dict[str, Any]]:
    if slot == "weapon":
        asset = _LPC_WEAPON_ASSET.get(class_name)
        return {"schemaVersion": "item_lpc_visual.v1", "slot": "weapon", "asset": asset} if asset else None
    return None


def _item(
    class_name: str,
    slot: str,
    tier: str,
    name: str,
    description: str,
    *,
    attack_bonus: int = 0,
    ability_bonus: int = 0,
    defend_reduction: int = 0,
    hp_bonus: int = 0,
    risk_win_chance: float = 0.0,
    passive_type: Optional[str] = None,
    passive_value: float = 0.0,
    image_path: Optional[str] = None,
    lpc_visual: Optional[Dict[str, Any]] = None,
) -> Dict:
    return {
        "name": name,
        "description": description,
        "class_name": class_name,
        "slot": slot,
        "tier": tier,
        "price": TIER_PRICE[tier],
        "attack_bonus": attack_bonus,
        "ability_bonus": ability_bonus,
        "defend_reduction": defend_reduction,
        "hp_bonus": hp_bonus,
        "risk_win_chance": risk_win_chance,
        "passive_type": passive_type,
        "passive_value": passive_value,
        "image_path": image_path or _weapon_image(class_name, slot),
        "lpc_visual": lpc_visual if lpc_visual is not None else _lpc_visual(class_name, slot),
    }


FULL_ITEM_CATALOG: List[Dict] = [
    _item("warrior", "weapon", "common", "Warrior Katana",  "A swift katana forged for arena combat.",    attack_bonus=8,  hp_bonus=5),
    _item("mage",    "weapon", "common", "Mage Staff",      "A staff that channels raw arcane power.",    attack_bonus=4,  ability_bonus=8),
    _item("rogue",   "weapon", "common", "Rogue Scimitar",  "A curved blade built for quick, risky strikes.", attack_bonus=6, risk_win_chance=0.08),
    # --- Warrior armor ---
    _item("warrior", "armor", "common",   "Iron Plate Armor",
          "Heavy iron plating forged for arena duels.",
          hp_bonus=12, passive_type="damage_reduction_percent", passive_value=0.03,
          image_path="/items/warrior_armor_plate.png",
          lpc_visual={"schemaVersion": "item_lpc_visual.v1", "slot": "torso", "asset": "torso.armour.plate"}),
    _item("warrior", "armor", "uncommon", "Legion Armor",
          "Reinforced plate worn by veteran arena champions.",
          hp_bonus=22, passive_type="damage_reduction_percent", passive_value=0.05,
          image_path="/items/warrior_armor_legion.png",
          lpc_visual={"schemaVersion": "item_lpc_visual.v1", "slot": "torso", "asset": "torso.armour.legion"}),
    _item("warrior", "armor", "rare",     "Chainmail Hauberk",
          "Interlocked rings offering exceptional protection.",
          hp_bonus=35, passive_type="damage_reduction_percent", passive_value=0.08,
          image_path="/items/warrior_armor_chainmail.png",
          lpc_visual={"schemaVersion": "item_lpc_visual.v1", "slot": "torso", "asset": "torso.armour.chainmail"}),
    # --- Rogue armor ---
    _item("rogue",   "armor", "common",   "Leather Vest",
          "Supple leather that keeps you nimble in the arena.",
          hp_bonus=8,  passive_type="risk_success_bonus", passive_value=0.03,
          image_path="/items/rogue_armor_leather.png",
          lpc_visual={"schemaVersion": "item_lpc_visual.v1", "slot": "torso", "asset": "torso.armour.leather"}),
    _item("rogue",   "armor", "uncommon", "Bandit Leathers",
          "Seasoned leather armor favored by arena outlaws.",
          hp_bonus=15, passive_type="risk_success_bonus", passive_value=0.05,
          image_path="/items/rogue_armor_bandit.png",
          lpc_visual={"schemaVersion": "item_lpc_visual.v1", "slot": "torso", "asset": "torso.armour.leather"}),
    _item("rogue",   "armor", "rare",     "Shadow Leather",
          "Dark-treated leather that channels strikes into vitality.",
          hp_bonus=25, passive_type="lifesteal_percent", passive_value=0.04,
          image_path="/items/rogue_armor_shadow.png",
          lpc_visual={"schemaVersion": "item_lpc_visual.v1", "slot": "torso", "asset": "torso.armour.leather"}),
    # --- Mage armor ---
    _item("mage",    "armor", "common",   "Cloth Wraps",
          "Light wrappings that barely impede arcane focus.",
          hp_bonus=6,  passive_type="bonus_ability_percent", passive_value=0.05,
          image_path="/items/mage_armor_cloth.png",
          lpc_visual={"schemaVersion": "item_lpc_visual.v1", "slot": "torso", "asset": "torso.armour.leather"}),
    _item("mage",    "armor", "uncommon", "Arcane Vest",
          "Enchanted vest that amplifies spellcasting potency.",
          hp_bonus=12, passive_type="bonus_ability_percent", passive_value=0.08,
          image_path="/items/mage_armor_arcane.png",
          lpc_visual={"schemaVersion": "item_lpc_visual.v1", "slot": "torso", "asset": "torso.armour.leather"}),
    _item("mage",    "armor", "rare",     "Mystic Leather",
          "Runic-inscribed leather that greatly boosts arcane abilities.",
          hp_bonus=20, passive_type="bonus_ability_percent", passive_value=0.12,
          image_path="/items/mage_armor_mystic.png",
          lpc_visual={"schemaVersion": "item_lpc_visual.v1", "slot": "torso", "asset": "torso.armour.leather"}),
]


def is_shop_tier(tier: str) -> bool:
    return (tier or "").lower() in SHOP_TIERS


def is_drop_only_tier(tier: str) -> bool:
    return (tier or "").lower() in DROP_ONLY_TIERS


def tier_to_rarity(tier: str) -> str:
    return TIER_TO_RARITY.get((tier or "").lower(), "Common")


def can_user_equip_item(user_class_name: Optional[str], item_class_name: Optional[str]) -> bool:
    return bool(user_class_name and item_class_name and user_class_name.lower() == item_class_name.lower())


def choose_inventory_copy_for_equip(copies: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    if not copies:
        raise LookupError("Item not in your inventory")
    if len(copies) > 1:
        raise ValueError("Multiple owned copies match this item_id; use inventory_id")
    return copies[0]


def resolve_effective_equipped_inventory_ids(
    inventory_rows: Iterable[Dict[str, Any]],
    equipped_rows: Iterable[Dict[str, Any]],
) -> Set[str]:
    legacy_candidates: Dict[Tuple[str, int], List[Tuple[str, Any, str]]] = {}
    for row in inventory_rows:
        inventory_id = row.get("id") or row.get("inventory_id")
        user_id = row.get("user_id")
        item_id = row.get("item_id") or row.get("catalog_item_id")
        if not inventory_id or not user_id or item_id is None:
            continue
        acquired_at = row.get("acquired_at")
        legacy_candidates.setdefault((user_id, int(item_id)), []).append(
            (str(inventory_id), acquired_at, str(inventory_id))
        )

    legacy_primary: Dict[Tuple[str, int], str] = {}
    for key, candidates in legacy_candidates.items():
        candidates.sort(key=lambda entry: (entry[1] or "", entry[2]))
        legacy_primary[key] = candidates[0][0]

    resolved: Set[str] = set()
    for row in equipped_rows:
        inventory_id = row.get("inventory_id")
        if inventory_id:
            resolved.add(str(inventory_id))
            continue
        user_id = row.get("user_id")
        item_id = row.get("item_id")
        if not user_id or item_id is None:
            continue
        fallback = legacy_primary.get((user_id, int(item_id)))
        if fallback:
            resolved.add(fallback)
    return resolved


def is_enchantable_slot(slot: Optional[str]) -> bool:
    return (slot or "").lower() in ENCHANTABLE_SLOTS


def max_enchant_for_tier(tier: Optional[str]) -> int:
    return ENCHANT_MAX_BY_TIER.get((tier or "").lower(), 0)


def safe_enchant_for_tier(tier: Optional[str]) -> int:
    return ENCHANT_SAFE_BY_TIER.get((tier or "").lower(), 0)


def enchant_success_chance(tier: Optional[str], current_level: int, scroll_type: str) -> float:
    tier_key = (tier or "").lower()
    if scroll_type not in SCROLL_TYPES:
        raise ValueError("Invalid scroll type")
    if current_level < 0:
        raise ValueError("Invalid enchant level")
    if current_level >= max_enchant_for_tier(tier_key):
        return 0.0
    if scroll_type == "normal_scroll" and current_level >= 5:
        return 0.0
    if current_level < safe_enchant_for_tier(tier_key):
        return 1.0
    base = ENCHANT_BASE_CHANCE_BY_TIER.get(tier_key, 0.0)
    decay = ENCHANT_DECAY_BY_LEVEL.get(tier_key, 0.0) * current_level
    minimum = ENCHANT_MIN_CHANCE_BY_TIER.get(tier_key, 0.0)
    return max(minimum, round(base - decay, 4))


def resolve_enchant_attempt(tier: str, current_level: int, scroll_type: str, roll: float) -> Dict:
    chance = enchant_success_chance(tier, current_level, scroll_type)
    success = roll < chance
    destroyed = False
    new_level = current_level
    if success:
        new_level = current_level + 1
    return {
        "success": success,
        "destroyed": destroyed,
        "previous_enchant_level": current_level,
        "new_enchant_level": new_level,
        "success_chance": chance,
        "roll": roll,
        "scroll_type": scroll_type,
    }


def enchant_bonus_for_item(slot: Optional[str], enchant_level: int) -> Dict:
    level = max(0, int(enchant_level or 0))
    slot_key = (slot or "").lower()
    if not is_enchantable_slot(slot_key) or level <= 0:
        return {}
    if slot_key == "weapon":
        return {
            "bonus_attack_percent": level * 0.025,
            "bonus_ability_percent": level * 0.005,
            "boss_damage_percent": level * 0.01,
        }
    return {
        "hp_bonus": level * 3,
        "damage_reduction_percent": level * 0.005,
    }


def modifiers_to_dict(modifiers: ItemModifiers) -> Dict:
    return asdict(modifiers)


def _non_zero_stats(stats: Dict[str, Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key in STAT_KEYS:
        value = stats.get(key, 0)
        if value:
            result[key] = value
    return result


def base_stats_for_item(item: Dict[str, Any]) -> Dict[str, Any]:
    """Flat catalog stats before enchant or passive effects."""
    return _non_zero_stats({
        "attack_bonus": int(item.get("attack_bonus", 0) or 0),
        "ability_bonus": int(item.get("ability_bonus", 0) or 0),
        "defend_reduction": float(item.get("defend_reduction", 0) or 0) / 100.0,
        "hp_bonus": int(item.get("hp_bonus", 0) or 0),
        "risk_win_chance": float(item.get("risk_win_chance", 0.0) or 0.0),
    })


def enchant_stats_for_item(item: Dict[str, Any], enchant_level: Optional[int] = None) -> Dict[str, Any]:
    level = int(item.get("enchant_level", 0) if enchant_level is None else enchant_level)
    return _non_zero_stats(enchant_bonus_for_item(item.get("slot"), level))


def passive_stats_for_item(item: Dict[str, Any]) -> Dict[str, Any]:
    passive_type = item.get("passive_type")
    passive_value = float(item.get("passive_value", 0.0) or 0.0)
    if passive_type not in PASSIVE_TYPES or not passive_value:
        return {}
    return {passive_type: passive_value}


def effective_stats_for_item(item: Dict[str, Any], enchant_level: Optional[int] = None) -> Dict[str, Any]:
    level = int(item.get("enchant_level", 0) if enchant_level is None else enchant_level)
    stats = modifiers_to_dict(aggregate_item_modifiers([{**item, "enchant_level": level}]))
    return _non_zero_stats(stats)


def stat_delta(from_stats: Dict[str, Any], to_stats: Dict[str, Any]) -> Dict[str, Any]:
    delta: Dict[str, Any] = {}
    for key in STAT_KEYS:
        value = (to_stats.get(key, 0) or 0) - (from_stats.get(key, 0) or 0)
        if isinstance(value, float):
            value = round(value, 10)
        if value:
            delta[key] = value
    return delta


def _format_stat_value(key: str, value: Any) -> str:
    if key in {
        "defend_reduction",
        "risk_win_chance",
        "bonus_attack_percent",
        "bonus_ability_percent",
        "damage_reduction_percent",
        "risk_success_bonus",
        "boss_damage_percent",
        "lifesteal_percent",
    }:
        return f"+{int(round(float(value) * 100))}%"
    return f"+{int(value)}"


def stat_summary_for_item(item: Dict[str, Any]) -> List[Dict[str, Any]]:
    slot = str(item.get("slot") or "").title()
    labels = {
        "attack_bonus": "ATK",
        "ability_bonus": "Ability",
        "defend_reduction": "Defense",
        "hp_bonus": "HP",
        "risk_win_chance": "Risk",
        "bonus_attack_percent": "ATK",
        "bonus_ability_percent": "Ability",
        "damage_reduction_percent": "Damage Reduction",
        "risk_success_bonus": "Risk",
        "boss_damage_percent": "Boss Damage",
        "lifesteal_percent": "Lifesteal",
    }
    summary: List[Dict[str, Any]] = []
    for key, value in effective_stats_for_item(item).items():
        stat_label = labels.get(key, key)
        summary.append({
            "stat": key,
            "value": value,
            "label": f"{_format_stat_value(key, value)} {stat_label}".strip(),
        })
    return summary


def item_stat_payload(item: Dict[str, Any]) -> Dict[str, Any]:
    """Structured per-copy stats for API views; combat math remains centralized here."""
    return {
        "base_stats": base_stats_for_item(item),
        "enchant_stats": enchant_stats_for_item(item),
        "passive_stats": passive_stats_for_item(item),
        "effective_stats": effective_stats_for_item(item),
        "passive_label": passive_label(item.get("passive_type"), float(item.get("passive_value", 0.0) or 0.0)),
        "stat_summary": stat_summary_for_item(item),
    }


def next_enchant_preview(item: Dict[str, Any], scroll_type: str = "normal_scroll") -> Dict[str, Any]:
    current_level = int(item.get("enchant_level", 0) or 0)
    tier = item.get("tier")
    max_level = max_enchant_for_tier(tier)
    next_level = min(current_level + 1, max_level)
    current_stats = effective_stats_for_item(item, current_level)
    next_stats = effective_stats_for_item(item, next_level)
    chance = enchant_success_chance(tier, current_level, scroll_type)
    return {
        "scroll_type": scroll_type,
        "current_enchant_level": current_level,
        "next_enchant_level": next_level,
        "max_enchant": max_level,
        "success_chance": chance,
        "current_stats": current_stats,
        "next_enchant_stats": enchant_stats_for_item(item, next_level),
        "next_effective_stats": next_stats,
        "delta_stats": stat_delta(current_stats, next_stats),
        "safe_until": 0,
        "can_destroy": False,
        "failure_behavior": "keep_copy",
        "at_max": current_level >= max_level,
    }


def _apply_passive(modifiers: ItemModifiers, passive_type: Optional[str], passive_value: float) -> ItemModifiers:
    if not passive_type or passive_type not in PASSIVE_TYPES:
        return modifiers
    updates = modifiers_to_dict(modifiers)
    updates[passive_type] = float(updates.get(passive_type, 0.0) or 0.0) + float(passive_value or 0.0)
    return ItemModifiers(**updates)


def aggregate_item_modifiers(item_rows: Iterable[Dict]) -> ItemModifiers:
    total = ItemModifiers()
    for row in item_rows:
        updates = modifiers_to_dict(total)
        updates["attack_bonus"] += int(row.get("attack_bonus", 0) or 0)
        updates["ability_bonus"] += int(row.get("ability_bonus", 0) or 0)
        updates["defend_reduction"] += float(row.get("defend_reduction", 0) or 0) / 100.0
        updates["hp_bonus"] += int(row.get("hp_bonus", 0) or 0)
        updates["risk_win_chance"] += float(row.get("risk_win_chance", 0.0) or 0.0)
        for key, value in enchant_bonus_for_item(row.get("slot"), int(row.get("enchant_level", 0) or 0)).items():
            updates[key] += value
        total = ItemModifiers(**updates)
        total = _apply_passive(total, row.get("passive_type"), float(row.get("passive_value", 0.0) or 0.0))
    return total


def stat_preview(item: Dict) -> str:
    return " | ".join(entry["label"] for entry in stat_summary_for_item(item))


def passive_label(passive_type: Optional[str], passive_value: float) -> str:
    if not passive_type or not passive_value:
        return ""
    pct = int(round(float(passive_value) * 100))
    labels = {
        "bonus_attack_percent": f"+{pct}% attack",
        "bonus_ability_percent": f"+{pct}% ability",
        "damage_reduction_percent": f"+{pct}% reduction",
        "risk_success_bonus": f"+{pct}% risk",
        "boss_damage_percent": f"+{pct}% boss dmg",
        "lifesteal_percent": f"+{pct}% lifesteal",
    }
    return labels.get(passive_type, "")


def seed_rows() -> List[tuple]:
    return [
        (
            item["name"],
            item["description"],
            item["class_name"],
            item["slot"],
            item["tier"],
            item["price"],
            item["attack_bonus"],
            item["ability_bonus"],
            item["defend_reduction"],
            item["hp_bonus"],
            item["risk_win_chance"],
            item["passive_type"],
            item["passive_value"],
            item["image_path"],
            json.dumps(item["lpc_visual"], sort_keys=True) if item.get("lpc_visual") else None,
        )
        for item in FULL_ITEM_CATALOG
    ]
