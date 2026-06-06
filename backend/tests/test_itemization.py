import pytest

from arena_domain import ItemModifiers
from itemization import (
    ANY_CLASS,
    DROP_ONLY_TIERS,
    FULL_ITEM_CATALOG,
    SHARED_SLOTS,
    SHOP_TIERS,
    VALID_ITEM_CLASSES,
    VALID_SLOTS,
    aggregate_item_modifiers,
    can_user_equip_item,
    choose_inventory_copy_for_equip,
    enchant_success_chance,
    is_enchantable_slot,
    item_stat_payload,
    max_enchant_for_tier,
    next_enchant_preview,
    resolve_effective_equipped_inventory_ids,
    resolve_enchant_attempt,
    stat_preview,
)


def test_catalog_entries_are_unique_and_well_formed():
    # Shared-slot items (e.g. helmets with class_name='any') intentionally collide on
    # (class, slot, tier) when multiple visual variants exist per tier — include the
    # name in the uniqueness key so the structural check still catches accidental dupes.
    all_tiers = SHOP_TIERS | DROP_ONLY_TIERS
    seen = set()
    for item in FULL_ITEM_CATALOG:
        key = (item["class_name"], item["slot"], item["tier"], item["name"])
        assert key not in seen, f"duplicate catalog entry {key}"
        seen.add(key)
        assert item["class_name"] in set(VALID_ITEM_CLASSES)
        assert item["slot"] in set(VALID_SLOTS)
        assert item["tier"] in all_tiers
        if item["class_name"] == ANY_CLASS:
            assert item["slot"] in SHARED_SLOTS, f"non-shared slot {item['slot']!r} cannot use class_name='any'"
    assert len(FULL_ITEM_CATALOG) == len(seen)


def test_shop_and_drop_rules_match_locked_design():
    for item in FULL_ITEM_CATALOG:
        if item["tier"] in SHOP_TIERS:
            assert item["price"] > 0
        if item["tier"] in DROP_ONLY_TIERS:
            assert item["price"] == 0


def test_each_class_has_complete_epic_and_legendary_boss_sets():
    for class_name in ("warrior", "mage", "rogue"):
        for tier in ("epic", "legendary"):
            class_slots = {
                item["slot"]
                for item in FULL_ITEM_CATALOG
                if item["class_name"] == class_name and item["tier"] == tier
            }
            shared_slots = {
                item["slot"]
                for item in FULL_ITEM_CATALOG
                if item["class_name"] == ANY_CLASS and item["tier"] == tier
            }
            assert {"weapon", "armor", "ability"} <= class_slots
            assert "helmet" in shared_slots


def test_passives_follow_current_armor_design():
    # Armor and helmet carry a passive at EVERY tier. Weapon and ability carry a passive
    # ONLY at the drop-only epic/legendary tiers (the boss-set pieces); common/uncommon/
    # rare weapons and abilities have none.
    for item in FULL_ITEM_CATALOG:
        if item["slot"] in {"armor", "helmet"} or item["tier"] in DROP_ONLY_TIERS:
            assert item["passive_type"], item
            assert item["passive_value"] > 0
        else:
            assert item["passive_type"] is None, item


def test_helmet_armor_passive_progression():
    # Helmet stat curve: HP and damage_reduction_percent scale strictly by tier.
    expected = {
        "common":    (5,  0.01),
        "uncommon":  (10, 0.02),
        "rare":      (18, 0.04),
        "epic":      (25, 0.06),
        "legendary": (35, 0.10),
    }
    for item in FULL_ITEM_CATALOG:
        if item["slot"] != "helmet":
            continue
        hp, reduction = expected[item["tier"]]
        assert item["hp_bonus"] == hp, f"{item['name']} hp_bonus={item['hp_bonus']}, expected {hp}"
        assert item["passive_type"] == "damage_reduction_percent", item
        assert item["passive_value"] == pytest.approx(reduction), \
            f"{item['name']} passive_value={item['passive_value']}, expected {reduction}"


def test_class_restriction_helper_is_strict_and_case_insensitive():
    assert can_user_equip_item("warrior", "warrior") is True
    assert can_user_equip_item("Mage", "mage") is True
    assert can_user_equip_item("rogue", "mage") is False


def test_shared_slot_items_can_be_equipped_by_any_class():
    # Helmets are class-agnostic — class_name='any' on the item OR a shared slot
    # (helmet) should let any logged-in class equip them.
    assert can_user_equip_item("warrior", "any", "helmet") is True
    assert can_user_equip_item("mage", "any", "helmet") is True
    assert can_user_equip_item("rogue", "any", "helmet") is True
    # Even if class_name disagrees, the shared slot wins.
    assert can_user_equip_item("warrior", "rogue", "helmet") is True
    # A non-shared slot with class='any' still accepts any logged-in class.
    assert can_user_equip_item("warrior", "any", "weapon") is True
    # No authenticated class → always rejected.
    assert can_user_equip_item("", "any", "helmet") is False
    assert can_user_equip_item(None, "warrior", "armor") is False


def test_helmet_is_not_enchantable():
    # Helmets are universal items; they don't share the enchant economy with weapon/armor.
    assert is_enchantable_slot("helmet") is False


def test_only_weapon_and_armor_are_enchantable():
    assert is_enchantable_slot("weapon") is True
    assert is_enchantable_slot("armor") is True
    assert is_enchantable_slot("ability") is False
    assert is_enchantable_slot("consumable") is False


def test_aggregate_item_modifiers_combines_flat_stats_and_passives():
    result = aggregate_item_modifiers([
        {
            "attack_bonus": 6,
            "ability_bonus": 0,
            "defend_reduction": 4,
            "hp_bonus": 12,
            "risk_win_chance": 0.07,
            "passive_type": "bonus_attack_percent",
            "passive_value": 0.10,
        },
        {
            "attack_bonus": 0,
            "ability_bonus": 9,
            "defend_reduction": 0,
            "hp_bonus": 0,
            "risk_win_chance": 0.0,
            "passive_type": "lifesteal_percent",
            "passive_value": 0.12,
        },
    ])

    assert result == ItemModifiers(
        attack_bonus=6,
        ability_bonus=9,
        defend_reduction=0.04,
        risk_win_chance=0.07,
        hp_bonus=12,
        bonus_attack_percent=0.10,
        lifesteal_percent=0.12,
    )


def test_enchant_caps_and_normal_scroll_ceiling():
    # Current design: every tier shares a max enchant of 10; normal scrolls can only
    # reach level 5 (blessed scrolls go higher).
    for tier in ("common", "uncommon", "rare", "epic", "legendary"):
        assert max_enchant_for_tier(tier) == 10
    assert enchant_success_chance("rare", 5, "normal_scroll") == 0.0   # normal hard-capped at 5
    assert enchant_success_chance("rare", 4, "normal_scroll") > 0.0
    assert enchant_success_chance("rare", 5, "blessed_scroll") > 0.0   # blessed continues past 5


def test_enchant_success_chance_model():
    # No guaranteed "safe" levels: even level 0 has a base chance (< 1.0) that decays
    # with level and floors at the per-tier minimum.
    assert enchant_success_chance("rare", 0, "normal_scroll") == 0.78        # base
    assert enchant_success_chance("rare", 1, "normal_scroll") == 0.71        # 0.78 - 0.07
    assert enchant_success_chance("legendary", 8, "blessed_scroll") == 0.18  # max(0.15, 0.58 - 0.40)


def test_above_safe_threshold_has_deterministic_tier_level_chance():
    assert enchant_success_chance("rare", 3, "normal_scroll") == 0.57
    assert enchant_success_chance("legendary", 6, "blessed_scroll") == 0.28


def test_enchant_failure_never_destroys_copy():
    # Current design removed item destruction: a failed enchant (normal OR blessed)
    # keeps the copy at its current level.
    for scroll in ("normal_scroll", "blessed_scroll"):
        result = resolve_enchant_attempt("rare", 4, scroll, roll=0.99)
        assert result["success"] is False
        assert result["destroyed"] is False
        assert result["new_enchant_level"] == 4


def test_blessed_scroll_failure_keeps_copy_and_level():
    result = resolve_enchant_attempt("rare", 4, "blessed_scroll", roll=0.99)

    assert result["success"] is False
    assert result["destroyed"] is False
    assert result["new_enchant_level"] == 4


def test_per_copy_enchant_isolation_in_modifier_aggregation():
    base_weapon = {
        "slot": "weapon",
        "attack_bonus": 10,
        "ability_bonus": 0,
        "defend_reduction": 0,
        "hp_bonus": 0,
        "risk_win_chance": 0.0,
        "passive_type": None,
        "passive_value": 0.0,
    }

    plain = aggregate_item_modifiers([{**base_weapon, "enchant_level": 0}])
    enchanted = aggregate_item_modifiers([{**base_weapon, "enchant_level": 4}])

    assert plain.bonus_attack_percent == 0
    assert enchanted.bonus_attack_percent == 0.10
    assert enchanted.boss_damage_percent == 0.04


def test_armor_enchant_adds_hp_and_survivability():
    result = aggregate_item_modifiers([
        {
            "slot": "armor",
            "attack_bonus": 0,
            "ability_bonus": 0,
            "defend_reduction": 5,
            "hp_bonus": 20,
            "risk_win_chance": 0.0,
            "passive_type": None,
            "passive_value": 0.0,
            "enchant_level": 3,
        }
    ])

    assert result.hp_bonus == 29
    assert result.defend_reduction == 0.05
    assert result.damage_reduction_percent == 0.015


def test_item_stat_payload_splits_base_enchant_passive_and_effective_stats():
    item = {
        "slot": "weapon",
        "attack_bonus": 12,
        "ability_bonus": 2,
        "defend_reduction": 0,
        "hp_bonus": 8,
        "risk_win_chance": 0.0,
        "passive_type": "bonus_attack_percent",
        "passive_value": 0.10,
        "enchant_level": 4,
    }

    payload = item_stat_payload(item)

    assert payload["base_stats"] == {
        "attack_bonus": 12,
        "ability_bonus": 2,
        "hp_bonus": 8,
    }
    assert payload["enchant_stats"] == {
        "bonus_attack_percent": 0.10,
        "bonus_ability_percent": 0.02,
        "boss_damage_percent": 0.04,
    }
    assert payload["passive_stats"] == {"bonus_attack_percent": 0.10}
    assert payload["effective_stats"]["attack_bonus"] == 12
    assert payload["effective_stats"]["bonus_attack_percent"] == pytest.approx(0.20)
    assert payload["effective_stats"]["bonus_ability_percent"] == pytest.approx(0.02)
    assert payload["effective_stats"]["boss_damage_percent"] == pytest.approx(0.04)
    assert payload["passive_label"] == "+10% attack"
    assert {entry["stat"] for entry in payload["stat_summary"]} >= {
        "attack_bonus",
        "bonus_attack_percent",
    }


def test_next_enchant_preview_uses_authoritative_next_level_stats_and_risk():
    item = {
        "slot": "armor",
        "tier": "rare",
        "attack_bonus": 0,
        "ability_bonus": 0,
        "defend_reduction": 5,
        "hp_bonus": 20,
        "risk_win_chance": 0.0,
        "passive_type": None,
        "passive_value": 0.0,
        "enchant_level": 3,
    }

    preview = next_enchant_preview(item, "normal_scroll")

    assert preview["current_enchant_level"] == 3
    assert preview["next_enchant_level"] == 4
    assert preview["max_enchant"] == 10
    assert preview["success_chance"] == 0.57
    assert preview["current_stats"]["hp_bonus"] == 29
    assert preview["next_enchant_stats"] == {
        "hp_bonus": 12,
        "damage_reduction_percent": 0.02,
    }
    assert preview["next_effective_stats"]["hp_bonus"] == 32
    assert preview["delta_stats"] == {
        "hp_bonus": 3,
        "damage_reduction_percent": 0.005,
    }
    # Current design removed destruction — failure always keeps the copy.
    assert preview["can_destroy"] is False
    assert preview["failure_behavior"] == "keep_copy"


def test_next_enchant_preview_at_max_reports_no_delta():
    item = {
        "slot": "weapon",
        "tier": "common",
        "attack_bonus": 4,
        "ability_bonus": 0,
        "defend_reduction": 0,
        "hp_bonus": 0,
        "risk_win_chance": 0.0,
        "passive_type": None,
        "passive_value": 0.0,
        "enchant_level": 10,  # max enchant for any tier in the current design
    }

    preview = next_enchant_preview(item, "blessed_scroll")

    assert preview["at_max"] is True
    assert preview["success_chance"] == 0.0
    assert preview["next_enchant_level"] == 10
    assert preview["delta_stats"] == {}
    assert preview["failure_behavior"] == "keep_copy"


def test_duplicate_copy_stat_payloads_stay_isolated_by_enchant_level():
    base_item = {
        "slot": "weapon",
        "attack_bonus": 10,
        "ability_bonus": 0,
        "defend_reduction": 0,
        "hp_bonus": 0,
        "risk_win_chance": 0.0,
        "passive_type": None,
        "passive_value": 0.0,
    }

    copy_a = item_stat_payload({**base_item, "inventory_id": "copy-a", "enchant_level": 0})
    copy_b = item_stat_payload({**base_item, "inventory_id": "copy-b", "enchant_level": 4})

    assert copy_a["effective_stats"] == {"attack_bonus": 10}
    assert copy_b["effective_stats"]["attack_bonus"] == 10
    assert copy_b["effective_stats"]["bonus_attack_percent"] == 0.10
    assert copy_b["effective_stats"]["boss_damage_percent"] == 0.04


def test_legacy_stat_preview_uses_effective_enchanted_stats():
    item = {
        "slot": "weapon",
        "attack_bonus": 10,
        "ability_bonus": 0,
        "defend_reduction": 0,
        "hp_bonus": 0,
        "risk_win_chance": 0.0,
        "passive_type": None,
        "passive_value": 0.0,
        "enchant_level": 4,
    }

    preview = stat_preview(item)

    # Current label format (no "Weapon" prefix): base ATK + enchant attack% + boss dmg%.
    assert "+10 ATK" in preview
    assert "+10% ATK" in preview
    assert "+4% Boss Damage" in preview


def test_legacy_item_id_equip_rejects_ambiguous_duplicate_copies():
    with pytest.raises(ValueError):
        choose_inventory_copy_for_equip(
            [
                {"inventory_id": "copy-a", "item_id": 7},
                {"inventory_id": "copy-b", "item_id": 7},
            ]
        )


def test_legacy_equipped_rows_resolve_to_oldest_matching_copy():
    inventory_rows = [
        {"id": "copy-new", "user_id": "u1", "catalog_item_id": 7, "acquired_at": "2026-05-02T00:00:00+00:00"},
        {"id": "copy-old", "user_id": "u1", "catalog_item_id": 7, "acquired_at": "2026-05-01T00:00:00+00:00"},
        {"id": "copy-explicit", "user_id": "u1", "catalog_item_id": 9, "acquired_at": "2026-05-03T00:00:00+00:00"},
    ]
    equipped_rows = [
        {"user_id": "u1", "slot": "weapon", "inventory_id": None, "item_id": 7},
        {"user_id": "u1", "slot": "armor", "inventory_id": "copy-explicit", "item_id": 9},
    ]

    assert resolve_effective_equipped_inventory_ids(inventory_rows, equipped_rows) == {
        "copy-old",
        "copy-explicit",
    }
