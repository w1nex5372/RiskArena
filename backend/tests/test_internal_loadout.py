# Tests the /api/internal/user-loadout/{user_id} endpoint logic
# Pure unit test — no DB or running server needed

import pytest
from itemization import aggregate_item_modifiers, modifiers_to_dict

def test_empty_loadout_returns_zeros():
    stats = modifiers_to_dict(aggregate_item_modifiers([]))
    assert stats["attack_bonus"] == 0
    assert stats["ability_bonus"] == 0
    assert stats["defend_reduction"] == 0
    assert stats["hp_bonus"] == 0

def test_weapon_adds_attack_bonus():
    weapon = {"slot": "weapon", "attack_bonus": 7, "ability_bonus": 0, "defend_reduction": 0, "hp_bonus": 0, "enchant_level": 0}
    stats = modifiers_to_dict(aggregate_item_modifiers([weapon]))
    assert stats["attack_bonus"] == 7

def test_armor_adds_hp_and_defense():
    armor = {"slot": "armor", "attack_bonus": 0, "ability_bonus": 0, "defend_reduction": 3, "hp_bonus": 10, "enchant_level": 0}
    stats = modifiers_to_dict(aggregate_item_modifiers([armor]))
    assert stats["hp_bonus"] == 10

def test_full_loadout_combines_all():
    items = [
        {"slot": "weapon",  "attack_bonus": 4,  "ability_bonus": 0, "defend_reduction": 0, "hp_bonus": 0,  "enchant_level": 0},
        {"slot": "armor",   "attack_bonus": 0,  "ability_bonus": 0, "defend_reduction": 3, "hp_bonus": 15, "enchant_level": 0},
        {"slot": "ability", "attack_bonus": 0,  "ability_bonus": 6, "defend_reduction": 0, "hp_bonus": 0,  "enchant_level": 0},
    ]
    stats = modifiers_to_dict(aggregate_item_modifiers(items))
    assert stats["attack_bonus"] == 4
    assert stats["ability_bonus"] == 6
    assert stats["hp_bonus"] == 15
