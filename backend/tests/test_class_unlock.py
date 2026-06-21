"""Class slot progression: 1 class from start, 2nd at level 10, 3rd at level 15."""
from progression import class_slots_for_level
from server import _class_unlock_fields


def test_one_slot_before_level_10():
    assert class_slots_for_level(1) == 1
    assert class_slots_for_level(9) == 1


def test_second_slot_unlocks_at_level_10():
    assert class_slots_for_level(10) == 2
    assert class_slots_for_level(14) == 2


def test_third_slot_unlocks_at_level_15():
    assert class_slots_for_level(15) == 3
    assert class_slots_for_level(99) == 3


def test_new_user_without_class_has_no_pending_unlock_modal():
    fields = _class_unlock_fields({"level": 1, "class_name": None, "unlocked_classes": []})
    assert fields["pending_class_unlocks"] == 0
    assert fields["unlocked_classes"] == []


def test_level_10_user_with_starting_class_has_pending_unlock():
    fields = _class_unlock_fields({"level": 10, "class_name": "warrior", "unlocked_classes": ["warrior"]})
    assert fields["pending_class_unlocks"] == 1
    assert fields["claimable_classes"] == ["mage", "rogue"]
